import './styles.css';
import '@fontsource/bitter/latin-ext-800.css';
import '@fontsource/special-elite/latin-ext-400.css';
import '@fontsource/cinzel-decorative/latin-ext-700.css';
import { AudioManager } from './audio/audio-manager';
import { MusicDirector } from './audio/music-director';
import { TRACK_BY_ID, trackSources } from './audio/music-catalog';
import { loadQuality, saveQuality } from './graphics/quality';
import { mountMenu } from './menu/menu';
import { mountGameUi, type GameUiActions } from './ui/game-ui';
import {
  createInitialState, createUiStore, type GameNotification, type ResourceLine,
} from './ui/ui-state';
import { autoDismissDelay, isSticky } from './ui/notification-lifecycle';
import { DEMO_ARMY, type ArmyPanelCommand } from './ui/army';
import { aggregateTroopStat, armyActivityLabel } from './ui/army-presentation';
import { iconMarkup } from './ui/icons';
import type { ProvinceResources } from './resource-nodes';
import type { WorldRenderer, MapMode, TimeOfDayState } from './renderer';
import { parseClock } from './time-of-day';
import type { CountryRecord, DiplomacyState, DiplomaticRelation, FrameStats, HoverInfo } from './types';
import { LOADING_QUOTES } from './loadingQuotes';
import { getGame, getSession, joinGame, logout } from './client/auth-api';
import { GameConnection } from './client/game-connection';
import { RemoteGameSession } from './client/remote-session';
import { configureWorldAssetBase } from './world-assets';
import { CombatEffectPool, EFFECT_KIND, effectDensityForDistance } from './combat-effects';
import type { SessionResponse } from '@ironfronts/protocol';
import { buildArmyCompositionRows, buildArmyFormation, dominantVisualKind } from './army-map-presentation';

type BuildingId = 'barracks' | 'tankPlant' | 'ordnance';

const gameUnit = (typeId: string): Record<string, unknown> => activeSession?.unit(typeId) ?? { id: typeId, name: typeId, cost: {} };
const gameUnitLabel = (typeId: string): string => String(gameUnit(typeId).name ?? typeId);
const unitCostLabel = (typeId: string): string => Object.entries((gameUnit(typeId).cost ?? {}) as Record<string, number>)
  .map(([k, v]) => `${v} ${k}`).join(' · ');
const buildingLabel = (id: BuildingId): string => String(activeSession?.building(id)?.label ?? id);
const buildingCostLabel = (id: BuildingId): string => Object.entries((activeSession?.building(id)?.cost ?? {}) as Record<string, number>)
  .map(([k, v]) => `${v} ${k}`).join(' · ');
const orderPercent = (o: { progressHours: number; totalHours: number }): number =>
  o.totalHours > 0 ? Math.min(99, Math.floor((o.progressHours / o.totalHours) * 100)) : 0;
/** Simulation runs at a fixed 0.05 game-hour / 100ms tick — 0.5 game-hours
 *  per real second at normal (1x, production) speed. Dev-only sim speed-ups
 *  are server-side and invisible here, so this is a normal-play estimate. */
const GAME_HOURS_PER_REAL_SECOND = 0.5;
const orderEtaSeconds = (o: { progressHours: number; totalHours: number }): number =>
  Math.max(0, (o.totalHours - o.progressHours) / GAME_HOURS_PER_REAL_SECOND);

/** Player queues a unit from the selected-province PRODUCE panel. */
function handleProduce(provinceId: number, unitTypeId: string): void {
  const session = activeSession;
  if (!session) return;
  const result = session.produce(provinceId, unitTypeId);
  if (!result.ok) {
    pushNotification('warning', 'Production', result.reason ?? 'Cannot build that here.');
    return;
  }
  pushNotification('information', `${gameUnitLabel(unitTypeId)} queued`, 'Now in the build queue.');
  if (selectedProvinceId === provinceId) refreshSelectedProvince(session);
}

/** Arm / clear the selected production city's rally point. */
function handleRally(provinceId: number, action: 'arm' | 'clear'): void {
  const session = activeSession;
  if (!session || selectedProvinceId !== provinceId) return;
  if (action === 'clear') {
    session.clearRally(provinceId);
    awaitingRallyTarget = false;
    pushNotification('information', 'Rally point cleared');
  } else {
    awaitingRallyTarget = !awaitingRallyTarget;
  }
  refreshSelectedProvince(session);
}

/** Player starts a building from the selected-province BUILD panel. */
function handleBuild(provinceId: number, buildingId: string): void {
  const session = activeSession;
  if (!session) return;
  const result = session.build(provinceId, buildingId as BuildingId);
  if (!result.ok) {
    pushNotification('warning', 'Construction', result.reason ?? 'Cannot build that here.');
    return;
  }
  pushNotification('information', `${buildingLabel(buildingId as BuildingId)} started`,
    'Construction is under way.');
  if (selectedProvinceId === provinceId) refreshSelectedProvince(session);
}

const canvas = required<HTMLCanvasElement>('world');
const countryLabels = required<HTMLCanvasElement>('country-labels');
const loading = required<HTMLElement>('loading');
const loadingStage = required<HTMLElement>('loading-stage');
const loadingValue = required<HTMLElement>('loading-value');
const loadingBar = required<HTMLElement>('loading-bar');
const loadingKind = required<HTMLElement>('loading-kind');
const loadingQuoteText = required<HTMLElement>('loading-quote-text');
const loadingQuoteSource = required<HTMLElement>('loading-quote-source');
const loadingFoot = required<HTMLElement>('loading-foot');
const loadingError = required<HTMLElement>('loading-error');
const loadingErrorMessage = required<HTMLElement>('loading-error-message');
const loadingRetry = required<HTMLButtonElement>('loading-retry');
const loadingReturn = required<HTMLButtonElement>('loading-return');
const tooltip = required<HTMLElement>('tooltip');
const tooltipName = required<HTMLElement>('tooltip-name');
const tooltipTerrain = required<HTMLElement>('tooltip-terrain');
const tooltipResources = required<HTMLElement>('tooltip-resources');
const debugToggle = required<HTMLButtonElement>('debug-toggle');
const diagnostics = required<HTMLElement>('diagnostics');
const diagnosticsStats = required<HTMLElement>('diagnostics-stats');
const diagnosticsPerformance = required<HTMLElement>('diagnostics-performance');
const debugTime = required<HTMLInputElement>('debug-time');
const debugTimeState = required<HTMLOutputElement>('debug-time-state');
const debugTimeMultiplier = required<HTMLInputElement>('debug-time-multiplier');
const debugTimePresets = [...document.querySelectorAll<HTMLButtonElement>('[data-debug-time]')];
const debugRain = required<HTMLInputElement>('debug-rain');
const debugThunder = required<HTMLButtonElement>('debug-thunder');
const debugSimSpeedState = required<HTMLOutputElement>('debug-sim-speed-state');
const debugSimSpeedButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-sim-speed]')];
const debugView = required<HTMLSelectElement>('debug-view');
const debugConnections = required<HTMLInputElement>('debug-connections');
const debugRivers = required<HTMLInputElement>('debug-rivers');
const debugWireframe = required<HTMLInputElement>('debug-wireframe');
const debugBorders = required<HTMLInputElement>('debug-borders');
const debugCountries = required<HTMLInputElement>('debug-countries');
const debugRoads = required<HTMLInputElement>('debug-roads');
const debugHidden = required<HTMLInputElement>('debug-hidden');
const debugWaterways = required<HTMLInputElement>('debug-waterways');
const debugProps = required<HTMLInputElement>('debug-props');
const debugDescription = required<HTMLElement>('debug-description');
const debugLegend = required<HTMLElement>('debug-legend');
const debugTabs = [...document.querySelectorAll<HTMLButtonElement>('[data-debug-tab]')];
const debugPanels = [...document.querySelectorAll<HTMLElement>('[data-debug-panel]')];
const debugPlayerCountry = required<HTMLElement>('debug-player-country');
const debugCountryFlag = required<HTMLElement>('debug-country-flag');
const debugPlayerForm = required<HTMLFormElement>('debug-player-form');
const debugPlayerInput = required<HTMLInputElement>('debug-player-input');
const debugWarForm = required<HTMLFormElement>('debug-war-form');
const debugWarInput = required<HTMLInputElement>('debug-at-war');
const debugAlliedForm = required<HTMLFormElement>('debug-allied-form');
const debugAlliedInput = required<HTMLInputElement>('debug-allied');
const debugWarList = required<HTMLElement>('debug-war-list');
const debugAlliedList = required<HTMLElement>('debug-allied-list');
const debugDiplomacyStatus = required<HTMLElement>('debug-diplomacy-status');
const debugCountryNames = required<HTMLDataListElement>('debug-country-names');
const mapModes = required<HTMLFieldSetElement>('map-modes');
const mapModeInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="map-mode"]')];
const unsupported = required<HTMLElement>('unsupported');
const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

const urlParams = new URLSearchParams(window.location.search);
// Debug / world-inspector affordances are opt-in only: ?debug (or the
// ?benchmark automation hook). They are NOT auto-enabled by the dev server, so
// `npm run dev` shows the real player experience by default.
const debugEnabled = urlParams.has('debug') || urlParams.has('benchmark');

// The single typed channel between renderer/game systems and the player HUD.
const uiStore = createUiStore(createInitialState({ quality: loadQuality(), debugEnabled }));

const audio = new AudioManager(safeLocalStorage());
const music = new MusicDirector(audio, {
  onTrackChange: (track) => updateNowPlaying(track ? track.title : null),
});
const firstMenuTrack = TRACK_BY_ID.get('honor-bound');
audio.prime(firstMenuTrack ? trackSources(firstMenuTrack).slice(0, 1) : []);
audio.installLifecycle();

// Try to start the lobby soundtrack immediately when the page opens. This is
// fire-and-forget: the browser is allowed to block audible autoplay after a
// navigation/refresh, and nothing in the app may ever wait on it.
void music.setState('menu').catch(() => undefined);

// Refresh-safe audio activation (concept adapted from PR #46). The listeners
// stay attached rather than firing once: an early resume() can be rejected or
// left pending by the autoplay policy, so every genuine gesture gets a chance
// to activate audio — and to recover playback for whatever musical state is
// current now, not always "menu". The gesture still does its normal job; this
// runs alongside it and never blocks it.
let audioActivationInFlight = false;
let audioPlaybackRecovered = false;
const recoverAudioAfterGesture = (): void => {
  if (audioActivationInFlight || (audioPlaybackRecovered && audio.isMusicPlaying())) return;
  audioActivationInFlight = true;
  // Yield a macrotask first: the gesture's own button action (and any paint it
  // causes) must land before we touch the AudioContext, whose construction /
  // resume can briefly block on some platforms. The gesture still counts as the
  // activation gesture — the browser attributes it to this task chain.
  window.setTimeout(() => {
    void (async () => {
      try {
        if (!await audio.unlock()) return;
        if (!audio.isMusicPlaying()) await music.resyncPlayback();
        if (audio.isMusicPlaying()) audioPlaybackRecovered = true;
      } catch {
        // Audio failure degrades to silence, never to a broken UI.
      } finally {
        audioActivationInFlight = false;
      }
    })();
  }, 0);
};
document.addEventListener('pointerdown', recoverAudioAfterGesture, { capture: true });
document.addEventListener('keydown', recoverAudioAfterGesture, { capture: true });

window.addEventListener('pagehide', (event) => {
  if (!event.persisted) {
    music.stop(0.05);
    audio.dispose();
  }
});

let rendererStarted = false;
let activeRenderer: WorldRenderer | undefined;
let activeSession: RemoteGameSession | undefined;
let activeConnection: GameConnection | undefined;
/** Pooled world-space combat visuals; fed by drainSessionEvents, drawn from onStats. */
const combatEffects = new CombatEffectPool(320);
let lastCombatCameraDistance = 3_000;
// Launch lifecycle: a monotonically increasing token invalidates a superseded
// attempt (Retry / Return to Command), a disposer list tears an aborted attempt
// down cleanly, and `launchOutcome` bridges to the menu's `onLaunch` promise so
// "Return to Command" restores the menu via its existing rejection path.
let launchToken = 0;
let currentLaunchCountryId = 0;
const launchDisposers: Array<() => void> = [];
let launchOutcome: { resolve: () => void; reject: (error: Error) => void } | null = null;
let activeStopQuotes: (() => void) | null = null;
let loaderHideTimer: number | undefined;
let selectedArmyId: string | null = null;
let awaitingMoveTarget = false;
let targetingMode: 'move' | 'attack' | 'retreat' | 'split' | null = null;
let pendingSplitGroups: Array<{ typeId: string; count: number }> | null = null;
// Selected province: id + the renderer-supplied labels, kept so the card can be
// re-projected from GameState (e.g. after a capture) without a reselect.
let selectedProvinceId: number | null = null;
let selectedProvinceName = '';
let selectedProvinceTerrain = '';
/** True while the next map click places the selected province's rally point. */
let awaitingRallyTarget = false;
const authenticated = await getSession().catch((): SessionResponse => ({ authenticated: false }));
if (!authenticated.authenticated || !authenticated.account) {
  window.location.replace('/login.html');
  await new Promise(() => { /* stop dossier bootstrap during navigation */ });
}
const lobby = await getGame();

mountMenu({
  audio,
  lobby,
  username: authenticated.account!.username,
  profile: authenticated.profile,
  onLogout: () => { void logout().finally(() => window.location.replace('/login.html')); },
  onLaunch: (countryId: number) => new Promise<void>((resolve, reject) => {
    if (rendererStarted) { resolve(); return; }
    rendererStarted = true;
    currentLaunchCountryId = countryId;
    launchOutcome = { resolve, reject };
    // Audio must NEVER gate entering the game — a silent game beats a stuck one.
    void music.setState('opening').catch(() => undefined);
    void runLaunch(countryId);
  }),
  // In the lobby this only persists; once the renderer exists it applies live.
  onGraphicsQuality: (level) => activeRenderer?.setQuality(level),
});

loadingRetry.addEventListener('click', () => {
  loadingError.hidden = true;
  loadingFoot.hidden = false;
  void runLaunch(currentLaunchCountryId);
});
loadingReturn.addEventListener('click', () => {
  void (async () => {
    launchToken += 1;
    await teardownPartialLaunch();
    loadingError.hidden = true;
    loadingFoot.hidden = false;
    hideLoader();
    canvas.hidden = true;
    uiStore.patch({ phase: 'lobby' });
    rendererStarted = false;
    const outcome = launchOutcome;
    launchOutcome = null;
    // Rejecting the menu's onLaunch promise triggers its own menu-restore path.
    outcome?.reject(new Error('Returned to command.'));
  })();
});

/** Reject a promise if it has not settled within `ms`. */
function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`${label} timed out after ${Math.round(ms / 1_000)}s.`)),
      ms,
    );
    work.then(
      (value) => { window.clearTimeout(timer); resolve(value); },
      (error: unknown) => { window.clearTimeout(timer); reject(error instanceof Error ? error : new Error(String(error))); },
    );
  });
}

function setLoadingStage(stage: string, progress?: number): void {
  loadingStage.textContent = stage;
  if (progress !== undefined) {
    const percentage = Math.max(0, Math.min(100, Math.round(progress * 100)));
    loadingValue.textContent = `${percentage}%`;
    loadingBar.style.width = `${percentage}%`;
  }
}

function cancelLoaderHide(): void {
  if (loaderHideTimer === undefined) return;
  window.clearTimeout(loaderHideTimer);
  loaderHideTimer = undefined;
}

function showLoader(): void {
  cancelLoaderHide();
  unsupported.hidden = true;
  loading.classList.remove('is-done');
  loadingError.hidden = true;
  loadingFoot.hidden = false;
  loading.hidden = false;
  // The panel itself still starts closed (so `npm run dev` opens on the real
  // player view), but in dev the toggle is visible so the visual lighting /
  // time controls are one click away without needing the ?debug URL param.
  debugToggle.hidden = !(debugEnabled || import.meta.env.DEV);
  mapModes.hidden = true;
}

function hideLoader(): void {
  cancelLoaderHide();
  loading.classList.add('is-done');
  loaderHideTimer = window.setTimeout(() => {
    loaderHideTimer = undefined;
    loading.hidden = true;
  }, 500);
}

function showLaunchError(message: string): void {
  cancelLoaderHide();
  loading.classList.remove('is-done');
  loading.hidden = false;
  loadingFoot.hidden = true;
  loadingErrorMessage.textContent = message || 'The operation could not be reached.';
  loadingError.hidden = false;
}

/** Roll back everything a failed / abandoned launch attempt created. */
async function teardownPartialLaunch(): Promise<void> {
  for (const dispose of launchDisposers.splice(0)) {
    try { dispose(); } catch (error) { console.warn('[launch] disposer failed', error); }
  }
  try { activeConnection?.close(); } catch (error) { console.warn('[launch] connection close failed', error); }
  activeConnection = undefined;
  try { activeRenderer?.dispose(); } catch (error) { console.warn('[launch] renderer dispose failed', error); }
  activeRenderer = undefined;
  activeSession = undefined;
  activeStopQuotes?.();
  activeStopQuotes = null;
  void audio.setWindEnabled(false);
  void audio.setOceanEnabled(false);
  void audio.setRainEnabled(false);
}

/**
 * Full launch lifecycle. Every awaited step is time-bounded and any failure —
 * from joinGame through bootstrapGameSession — lands on the loader's error
 * state (Retry / Return to Command) instead of an indefinite hang.
 */
async function runLaunch(countryId: number): Promise<void> {
  const token = (launchToken += 1);
  // Populate the Field Note and first stage BEFORE the loader is unhidden so it
  // never appears for a frame with an empty quote / stale bar.
  if (!activeStopQuotes) activeStopQuotes = startLoadingQuotes();
  setLoadingStage('Connecting to command server', 0);
  showLoader();
  uiStore.patch({ phase: 'loading' });

  try {
    if (lobby.assignedCountryId === null) {
      setLoadingStage('Registering for the operation', 0.02);
      await withTimeout(joinGame(countryId), 15_000, 'Joining the campaign');
      lobby.assignedCountryId = countryId;
    }

    // Renderer module graph, WebGPU device and world assets are all deferred
    // until the player actually commits to an operation.
    if (!navigator.gpu) {
      hideLoader();
      canvas.hidden = true;
      unsupported.hidden = false;
      // The unsupported screen is the terminal UI for this launch attempt, so
      // settle the menu's launch promise instead of leaking it forever.
      launchOutcome?.resolve();
      launchOutcome = null;
      return;
    }

    canvas.hidden = false;
    await startGame(token);
    if (token !== launchToken) return; // superseded by Retry / Return

    launchOutcome?.resolve();
    launchOutcome = null;
  } catch (error) {
    if (token !== launchToken) return; // superseded — ignore this attempt's failure
    console.error('[launch] failed', error);
    await teardownPartialLaunch();
    showLaunchError(error instanceof Error ? error.message : String(error));
  }
}

function startLoadingQuotes(): () => void {
  const order = LOADING_QUOTES.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  let index = 0;
  const show = () => {
    const quote = LOADING_QUOTES[order[index % order.length]];
    loadingKind.textContent = quote.kind;
    loadingQuoteText.textContent = quote.text;
    loadingQuoteSource.textContent = quote.source;
    index += 1;
  };
  show();
  const timer = window.setInterval(show, 6000);
  return () => window.clearInterval(timer);
}

async function startGame(token: number): Promise<void> {
  const connection = await withTimeout(
    GameConnection.open((stage) => setLoadingStage(stage, 0.08)),
    20_000,
    'Connecting to command server',
  );
  if (token !== launchToken) { connection.close(); return; }
  activeConnection = connection;
  configureWorldAssetBase(connection.world.assetBaseUrl);
  const session = new RemoteGameSession(connection, (reason) => {
    // Server rejected an order. Show a concise, specific headline derived from
    // the reason (not a flat "Command failed") with the full reason beneath.
    const { title, body } = describeOrderFailure(reason);
    pushNotification('warning', title, body);
  });
  activeSession = session;

  // Keep the complete renderer/world module graph out of the lobby bundle.
  // This import is the first point at which world rendering code is loaded.
  setLoadingStage('Loading renderer', 0.12);
  const { WorldRenderer } = await withTimeout(import('./renderer'), 30_000, 'Loading the renderer');
  if (token !== launchToken) return;
  const renderer = new WorldRenderer(canvas, countryLabels, loadQuality());
  activeRenderer = renderer;

  // Every DOM/debug listener below belongs to this renderer attempt. Retry or
  // Return to Command aborts them in one shot so failed launches cannot retain
  // an old renderer or stack duplicate handlers onto the next attempt.
  const attemptEvents = new AbortController();
  const attemptListener = { signal: attemptEvents.signal } as const;
  launchDisposers.push(() => attemptEvents.abort());

  const disposeRendererOnPagehide = (event: PageTransitionEvent): void => {
    if (!event.persisted) renderer.dispose();
  };
  window.addEventListener('pagehide', disposeRendererOnPagehide);
  launchDisposers.push(() => window.removeEventListener('pagehide', disposeRendererOnPagehide));
  if (import.meta.env.DEV || debugEnabled) {
    // Invisible automation handle (QA capture / perf scripts). Not a player-
    // facing affordance.
    (window as Window & {
      __ironfrontsRenderer?: WorldRenderer;
      __ironfrontsCombatEffects?: CombatEffectPool;
    }).__ironfrontsRenderer = renderer;
    (window as Window & { __ironfrontsCombatEffects?: CombatEffectPool })
      .__ironfrontsCombatEffects = combatEffects;
  }
  // Hover deposits come from the fog-aware GameSession projection once it
  // exists; before that (and for water) show no deposit chips. The renderer's
  // own natural-resource table bypasses fog and must not drive player hover.
  renderer.onHover = (info, x, y) =>
    updateTooltip(info, x, y, info && activeSession
      ? activeSession.describeProvince(info.id).resources
      : null);

  // Attack-order cursor feedback. With an own army selected, the world cursor
  // becomes the 0 A.D. attack cursor over a *fully identified* enemy stack, and
  // the "no" cursor while aiming an attack at anything that can't be struck.
  // Gating on `contact === 'visible'` keeps the cursor honest with the server's
  // "a strike needs an identified target" rule — a contact-only blip gets no
  // attack affordance, so hovering never confirms an unseen force is there.
  const updateWorldCursor = (clientX: number, clientY: number): void => {
    const session = activeSession;
    // Rally-point placement is province-scoped, not army-scoped: 0 A.D. rally
    // cursor while it is armed.
    if (session && awaitingRallyTarget && selectedProvinceId !== null
      && session.ownsProvince(selectedProvinceId)) {
      canvas.style.cursor = 'url(/cursors/cursor-rally.png) 5 31, crosshair';
      return;
    }
    if (!session || !selectedArmyId || !session.ownsArmy(selectedArmyId)) {
      canvas.style.cursor = '';
      return;
    }
    const hoveredId = renderer.pickArmyAt(clientX, clientY);
    const hovered = hoveredId && hoveredId !== selectedArmyId ? session.army(hoveredId) : null;
    const strikable = Boolean(hovered && !hovered.own && hovered.contact === 'visible');
    if (strikable) {
      canvas.style.cursor = 'url(/cursors/action-attack.png) 1 1, crosshair';
    } else if (targetingMode === 'attack') {
      canvas.style.cursor = 'url(/cursors/cursor-no.png) 13 14, not-allowed';
    } else if (targetingMode === 'move' || targetingMode === 'split' || targetingMode === 'retreat' || awaitingMoveTarget) {
      // Aiming a ground order — a plain precision cursor (0 A.D. has no bare
      // "move" cursor clean enough to vendor).
      canvas.style.cursor = 'crosshair';
    } else {
      canvas.style.cursor = '';
    }
  };
  canvas.addEventListener('pointermove', (event) => {
    updateWorldCursor(event.clientX, event.clientY);
  }, attemptListener);

  // ---- Player HUD: typed state in, typed actions out -----------------
  const setMapModeUnified = (mode: MapMode): void => {
    const input = mapModeInputs.find((candidate) => candidate.value === mode);
    if (input && !input.checked) input.checked = true;
    renderer.setMapMode(mode);
    uiStore.patch({ mapMode: mode });
  };
  const gameUiActions: GameUiActions = {
    setMapMode: (mode) => setMapModeUnified(mode as MapMode),
    clearSelection: () => renderer.clearProvinceSelection(),
    setQuality: (level) => {
      renderer.setQuality(level);
      saveQuality(level);
      uiStore.patch({ quality: level, effectiveRenderScale: renderer.effectiveRenderScale });
    },
    navSelect: () => { /* No player-facing system is implemented yet. */ },
    dismissNotification: (id) => removeNotification(id),
    togglePause: (open) => uiStore.patch({ paused: open }),
    toggleResourceOverlay: (on) => {
      renderer.setResourceOverlay(on);
      uiStore.patch({ resourceOverlay: on });
    },
    returnToMenu: () => { /* Disabled in the UI until a safe menu-return path exists. */ },
    openDebugInspector: () => {
      if (debugEnabled) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F3', key: 'F3' }));
    },
    focusWorld: (x, z) => renderer.focus(x, z, 900),
    armyCommand: (command) => handleArmyCommand(command),
    produceUnit: (provinceId, unitTypeId) => handleProduce(provinceId, unitTypeId),
    buildStructure: (provinceId, buildingId) => handleBuild(provinceId, buildingId),
    rallyPoint: (provinceId, action) => handleRally(provinceId, action),
  };
  const gameUi = mountGameUi(uiStore, gameUiActions);
  const destroyGameUiOnPagehide = (event: PageTransitionEvent): void => {
    if (!event.persisted) gameUi.destroy();
  };
  window.addEventListener('pagehide', destroyGameUiOnPagehide);
  launchDisposers.push(() => {
    window.removeEventListener('pagehide', destroyGameUiOnPagehide);
    try { gameUi.destroy(); } catch (error) { console.warn('[launch] gameUi destroy failed', error); }
  });

  let oceanAudible = false;
  // The resource overlay is a GPU instanced layer inside the renderer now, so
  // this slow-cadence callback only drives audio + the debug readout. No
  // per-frame projection, no DOM marker writes.
  renderer.onStats = (stats) => {
    const shouldHearOcean = stats.targetProvince === null && stats.distance < 2_800;
    if (shouldHearOcean !== oceanAudible) {
      oceanAudible = shouldHearOcean;
      void audio.setOceanEnabled(oceanAudible);
    }
    // Repack the pooled combat effects for this frame (cheap: <=320*8 floats,
    // reused buffer). Transients past the LOD range are dropped CPU-side; the
    // renderer stops drawing everything past its own max distance.
    lastCombatCameraDistance = stats.distance;
    const packed = combatEffects.collect(
      Date.now(),
      { x: stats.camera[0], z: stats.camera[1] },
      renderer.combatEffectMaxDistance,
    );
    renderer.setCombatEffects(packed.floats, packed.count);
    if (!diagnostics.hidden) updateDiagnostics(stats);
  };
  renderer.onDiplomacyChange = (state) => {
    renderDiplomacyState(renderer, state);
    uiStore.patch({ playerCountry: { name: state.player.name, color: state.player.color } });
    if (state.enemies.length > 0 && music.getState() !== 'victory') {
      void music.setState('war');
    } else if (state.enemies.length === 0 && music.getState() === 'war') {
      void music.setState('peace');
    }
  };
  renderer.onProvinceSelected = (info) => {
    if (!info) {
      selectedProvinceId = null;
      awaitingRallyTarget = false;
      uiStore.patch({ selectedProvince: null });
      return;
    }
    // Prefer authoritative, fog-aware GameState detail once the session exists.
    const session = activeSession;
    if (session) {
      if (info.id !== selectedProvinceId) awaitingRallyTarget = false;
      selectedProvinceId = info.id;
      selectedProvinceName = info.name;
      selectedProvinceTerrain = info.terrain;
      uiStore.patch({ selectedProvince: projectSelectedProvince(session, info.id) });
      selectedArmyId = null;
      awaitingMoveTarget = false;
      targetingMode = null;
      pendingSplitGroups = null;
      return;
    }
    uiStore.patch({
      selectedProvince: {
        id: info.id,
        name: info.name,
        owner: info.country,
        ownerColor: info.countryColor,
        terrain: info.terrain,
        resources: renderer.getProvinceResources(info.id),
      },
    });
  };
  renderer.onTimeOfDayChange = (state) => {
    updateTimeControls(state);
  };

  debugTime.addEventListener('change', () => {
    const hour = parseClock(debugTime.value);
    if (hour !== undefined) renderer.setTimeOfDay(hour);
  }, attemptListener);
  for (const preset of debugTimePresets) {
    preset.addEventListener('click', () => renderer.setTimeOfDay(Number(preset.dataset.debugTime)), attemptListener);
  }
  const applyTimeMultiplier = () => {
    if (debugTimeMultiplier.value === '') return;
    const multiplier = renderer.setTimeMultiplier(Number(debugTimeMultiplier.value));
    debugTimeMultiplier.value = multiplier.toFixed(1);
  };
  debugTimeMultiplier.addEventListener('change', applyTimeMultiplier, attemptListener);
  debugTimeMultiplier.addEventListener('blur', applyTimeMultiplier, attemptListener);
  debugRain.addEventListener('change', () => {
    renderer.setRainEnabled(debugRain.checked);
    void audio.setRainEnabled(debugRain.checked);
    uiStore.patch({ weather: { raining: debugRain.checked, label: debugRain.checked ? 'Rain' : 'Clear' } });
  }, attemptListener);
  debugThunder.addEventListener('click', () => {
    void audio.playThunder();
  }, attemptListener);

  for (const tab of debugTabs) {
    tab.addEventListener('click', () => {
      const selected = tab.dataset.debugTab;
      for (const candidate of debugTabs) candidate.setAttribute('aria-selected', String(candidate === tab));
      for (const panel of debugPanels) panel.hidden = panel.dataset.debugPanel !== selected;
    }, attemptListener);
  }

  debugPlayerForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const country = renderer.setPlayerCountryByName(debugPlayerInput.value);
    if (!country) {
      setDiplomacyStatus(`No country exactly matches “${debugPlayerInput.value.trim()}”.`, true);
      return;
    }
    debugPlayerInput.value = '';
    setDiplomacyStatus(`Country flag switched to ${country.name}. Diplomatic placeholders were cleared.`);
  }, attemptListener);

  const bindRelationForm = (
    form: HTMLFormElement,
    input: HTMLInputElement,
    relation: Exclude<DiplomaticRelation, 'neutral'>,
  ) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const country = renderer.setDiplomaticRelationByName(input.value, relation);
      if (!country) {
        setDiplomacyStatus(`“${input.value.trim()}” is unknown or is your current country.`, true);
        return;
      }
      input.value = '';
      setDiplomacyStatus(relation === 'war'
        ? `${country.name} is now at war with you. Click its provinces to take them.`
        : `${country.name} is now allied with you.`);
    }, attemptListener);
  };
  bindRelationForm(debugWarForm, debugWarInput, 'war');
  bindRelationForm(debugAlliedForm, debugAlliedInput, 'allied');

  const applyDebugView = () => {
    const mode = Number(debugView.value);
    renderer.setDebugView(mode);
    updateDebugHelp(mode);
  };
  const applyMapMode = () => {
    const selected = mapModeInputs.find((input) => input.checked)?.value;
    if (selected && isMapMode(selected)) setMapModeUnified(selected);
  };
  const toggleDiagnostics = () => {
    diagnostics.hidden = !diagnostics.hidden;
    debugToggle.setAttribute('aria-expanded', String(!diagnostics.hidden));
  };
  debugToggle.addEventListener('click', toggleDiagnostics, attemptListener);
  window.addEventListener('keydown', (event) => {
    if (event.code === 'F3') {
      if (!debugEnabled) return;
      event.preventDefault();
      toggleDiagnostics();
      return;
    }
    if (diagnostics.hidden || (event.code !== 'BracketLeft' && event.code !== 'BracketRight')) return;
    event.preventDefault();
    const direction = event.code === 'BracketRight' ? 1 : -1;
    const count = debugView.options.length;
    debugView.selectedIndex = (debugView.selectedIndex + direction + count) % count;
    applyDebugView();
  }, attemptListener);
  for (const input of mapModeInputs) input.addEventListener('change', applyMapMode, attemptListener);
  applyMapMode();
  debugView.addEventListener('change', applyDebugView, attemptListener);
  debugWireframe.addEventListener('change', () => renderer.setWireframe(debugWireframe.checked), attemptListener);
  debugCountries.addEventListener('change', () => renderer.setCountryOverlayVisible(debugCountries.checked), attemptListener);
  debugBorders.addEventListener('change', () => renderer.setBordersVisible(debugBorders.checked), attemptListener);
  debugRoads.addEventListener('change', () => renderer.setRoadsVisible(debugRoads.checked), attemptListener);
  debugHidden.addEventListener('change', () => renderer.setHiddenConnectionsVisible(debugHidden.checked), attemptListener);
  debugWaterways.addEventListener('change', () => renderer.setWaterwaysVisible(debugWaterways.checked), attemptListener);
  debugProps.addEventListener('change', () => renderer.setPropsVisible(debugProps.checked), attemptListener);
  debugConnections.addEventListener('change', async () => {
    debugConnections.disabled = true;
    try {
      await renderer.setConnectionsVisible(debugConnections.checked);
    } finally {
      debugConnections.disabled = false;
    }
  }, attemptListener);
  debugRivers.addEventListener('change', async () => {
    debugRivers.disabled = true;
    try {
      await renderer.setWaterwayNetworkVisible(debugRivers.checked);
    } finally {
      debugRivers.disabled = false;
    }
  }, attemptListener);
  // Any failure from here on propagates to runLaunch(), which tears the partial
  // attempt down and shows the loader's Retry / Return-to-Command error state.
  await withTimeout(
    renderer.initialize((stage, progress) => setLoadingStage(stage, 0.12 + progress * 0.8)),
    90_000,
    'Preparing the renderer',
  );
  if (token !== launchToken) return;
  debugCountryNames.replaceChildren(...renderer.getCountries()
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((country) => {
      const option = document.createElement('option');
      option.value = country.name;
      return option;
    }));
  applyDebugView();
  void audio.setWindEnabled(true);
  setLoadingStage('Deploying forces', 0.95);
  renderer.start();

  // ---- Authoritative game session (Phase A wiring) -----------------
  // The renderer is now a data source + presentation cache; GameSession owns
  // gameplay state. Build WorldData from the loaded package and start the
  // fixed-step simulation.
  await withTimeout(bootstrapGameSession(renderer, session), 30_000, 'Deploying forces');
  if (token !== launchToken) return;

  setLoadingStage('Entering operation', 1);
  activeStopQuotes?.();
  activeStopQuotes = null;
  hideLoader();

  // Hand the HUD its opening state from real renderer/game values.
  const clock = session.readClock();
  uiStore.patch({
    phase: 'in-game',
    clock,
    quality: renderer.graphicsQuality,
    effectiveRenderScale: renderer.effectiveRenderScale,
    weather: { raining: renderer.isRainEnabled(), label: renderer.isRainEnabled() ? 'Rain' : 'Clear' },
  });
  if (debugEnabled) {
    // Dev-only fixtures so screenshots have content. Routed through the normal
    // lifecycle so they auto-expire like any real toast — they used to be
    // patched in raw and sat on screen forever.
    for (const demo of DEMO_NOTIFICATIONS) pushNotification(demo.kind, demo.title, demo.body);
    uiStore.patch({ selectedArmy: DEMO_ARMY });
  }
}

function updateTimeControls(state: TimeOfDayState): void {
  debugTimeState.textContent = `${state.stage} · ${state.clock}`;
  if (document.activeElement !== debugTime) debugTime.value = state.clock;
  if (document.activeElement !== debugTimeMultiplier) debugTimeMultiplier.value = state.multiplier.toFixed(1);
}

const simSpeedGroup = debugSimSpeedButtons[0]?.closest<HTMLElement>('.sim-speed-controls');
/**
 * Dev-only simulation-speed control: server-authoritative, shared by every
 * connected player. Hidden (not just disabled) against a production server so
 * it never offers a lever that would silently do nothing. Uses `activeSession`
 * rather than a closed-over session so it can be polled from bootstrapGameSession's
 * HUD timer, which runs in a different function scope than these buttons.
 */
function syncSimSpeedUi(): void {
  const session = activeSession;
  if (simSpeedGroup) simSpeedGroup.hidden = !session || !session.devSimSpeedEnabled;
  if (!session) return;
  debugSimSpeedState.textContent = session.devSimSpeed === 0 ? 'Paused' : `${session.devSimSpeed}×`;
  for (const button of debugSimSpeedButtons) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.simSpeed) === session.devSimSpeed));
  }
}
for (const button of debugSimSpeedButtons) {
  // Module-level, one-time wiring (unlike the per-launch listeners above,
  // these static buttons and activeSession outlive any single game attempt).
  button.addEventListener('click', () => {
    activeSession?.setDevSimSpeed(Number(button.dataset.simSpeed));
  });
}

async function bootstrapGameSession(
  renderer: WorldRenderer, session: RemoteGameSession,
): Promise<void> {
  selectedArmyId = null;
  awaitingMoveTarget = false;
  targetingMode = null;
  pendingSplitGroups = null;
  if (import.meta.env.DEV || debugEnabled) {
    // Authoritative-state inspection handle for QA / perf scripts. Exposing the
    // full GameState defeats fog of war, so it is DEV / ?debug only — never the
    // normal player build.
    (window as Window & { __ironfrontsSession?: RemoteGameSession }).__ironfrontsSession = session;
  }

  // One nearby country becomes an active opponent; the rest stay passive.
  // All unclaimed countries remain neutral; the server changes controller state on claim.

  // Player identity -> renderer flag/tint + HUD.
  const player = session.ownCountry;
  // The world package contains scenario-start ownership. A continued session
  // must apply its authoritative snapshot before the first rendered frame;
  // capture events only cover changes that happen after this connection.
  renderer.setProvinceOwners(Object.entries(session.state.provinceOwners).map(([provinceId, countryId]) => ({
    provinceId: Number(provinceId), countryId,
  })));
  renderer.setPlayerCountryByName(player.name);
  const { x, z, distance } = session.state.startCamera;
  // Deterministic near-top-down view centred on the player's homeland; no prior
  // orbit orientation carries over. The player can orbit away afterwards.
  renderer.focusPlayerStart(x, z, distance);

  // Left-tap -> army selection / armed-order placement (does not also select a
  // province if it was consumed). Right-click -> direct move/attack order for
  // the selected army, the primary fast interaction.
  renderer.onMapClick = (clientX, clientY) => handleMapClick(renderer, session, clientX, clientY);
  renderer.onMapCommand = (clientX, clientY) => handleMapCommand(renderer, session, clientX, clientY);
  session.addEventListener('war-confirmation', (event) => {
    const detail = (event as CustomEvent<{
      countryIds: number[]; respond: (confirmed: boolean) => void;
    }>).detail;
    const names = detail.countryIds.map((id) => session.state.countries[id]?.name ?? `Country ${id}`);
    void showGameConfirmation(
      'Declare war?',
      `This order requires war with ${names.join(', ')}. Declaration and order will be committed together.`,
    ).then(detail.respond);
  });

  // Resource deposits are gameplay-relevant from turn 0 — show the overlay by
  // default so the player can see where stone / metal / oil are, and feed
  // the renderer the authoritative set (natural + scenario-guaranteed).
  renderer.setResourceOverlay(true);
  syncResourceMarkers(session, renderer);

  uiStore.patch({
    playerCountry: { name: player.name, color: player.color },
    resources: playerResourceLines(session),
    resourceOverlay: true,
  });

  // Initial marker upload (before the first sim tick) so armies show at once.
  syncArmyMarkers(session, renderer);

  // Civil time is sparse server state, interpolated locally at 1:1 speed. It
  // drives lighting and the analogue HUD, but never changes gameplay dt: the
  // server retains its existing 10 Hz / 0.05-hour simulation ticks.
  renderer.setTimeMultiplier(0);
  const updateCivilClock = (): void => {
    const clock = session.readClock();
    uiStore.patch({ clock });
    renderer.setTimeOfDay(clock.hour + clock.minute / 60 + clock.second / 3_600);
  };
  updateCivilClock();
  const civilClockTimer = window.setInterval(updateCivilClock, 250);

  // Replica/HUD refresh, decoupled from the authoritative simulation.
  const hudTimer = window.setInterval(() => {
    // Fog visibility is O(foreignArmies × visionSources); compute it once per
    // HUD tick and share it between the marker upload and the selection card.
    uiStore.patch({ resources: playerResourceLines(session) });
    syncArmyMarkers(session, renderer);
    syncResourceMarkers(session, renderer);
    syncCombatMarkers(session);
    refreshSelectedArmy(session);
    refreshSelectedProvince(session); // keep production / construction % live
    drainSessionEvents(session);
    syncSimSpeedUi();
  }, 400);
  const onKey = (event: KeyboardEvent): void => {
    if (event.repeat || !selectedArmyId) return;
    if (event.key === 'm' || event.key === 'M') {
      targetingMode = 'move'; awaitingMoveTarget = true; refreshSelectedArmy(session);
    } else if (event.key === 'a' || event.key === 'A') {
      handleArmyCommand('attack');
    } else if (event.key === 's' || event.key === 'S') {
      session.orderStop(selectedArmyId); targetingMode = null; awaitingMoveTarget = false; refreshSelectedArmy(session);
    }
    else if (event.key === 'r' || event.key === 'R') { handleArmyCommand('retreat'); }
    else if (event.key === 'x' || event.key === 'X') { handleArmyCommand('split'); }
    else if (event.key === 'e' || event.key === 'E') { handleArmyCommand('extract'); }
    else if (event.key === 'Escape') { deselectArmy(); }
  };
  window.addEventListener('keydown', onKey);
  const teardownSession = (): void => {
    window.clearInterval(hudTimer);
    window.clearInterval(civilClockTimer);
    window.removeEventListener('keydown', onKey);
    clearAllNotificationTimers();
    combatEffects.clear();
    if (activeSession === session) activeSession = undefined;
  };
  const teardownSessionOnPagehide = (event: PageTransitionEvent): void => {
    if (!event.persisted) { teardownSession(); activeConnection?.close(); }
  };
  window.addEventListener('pagehide', teardownSessionOnPagehide);
  // Also reachable from Retry / Return to Command before the game is entered.
  launchDisposers.push(() => {
    window.removeEventListener('pagehide', teardownSessionOnPagehide);
    teardownSession();
  });

  console.info(
    `[game] ${player.name} connected — camera @ ${Math.round(x)},${Math.round(z)}`,
  );
}

const armyMarkerScratch = new Float32Array(16 * 1_024);
const armyModelScratch = new Float32Array(12 * 4_096);
const resourceMarkerScratch = new Float32Array(4 * 4_096);
/** LineRecord (8 f32) per own-army route segment — see renderer.setOrderRoutes. */
const routeScratch = new Float32Array(8 * 4_096);
const RESOURCE_KIND_INDEX: Record<'stone' | 'metal' | 'oil', number> = { stone: 0, metal: 1, oil: 2 };

/** Push the deposit set the PLAYER may see (own-controlled + anything inside
 *  friendly vision; all of it in sandbox) to the renderer's dynamic deposit-
 *  marker layer. Depleted nodes shrink; exhausted ones drop out. Foreign
 *  deposits are not globally revealed by the overlay. */
function syncResourceMarkers(
  session: RemoteGameSession, renderer: WorldRenderer,
): void {
  let cursor = 0;
  let count = 0;
  for (const value of Object.values(session.state.resourceNodes)) {
    const node = value as { x: number; z: number; kind: 'stone' | 'metal' | 'oil'; remaining: number; initialAmount: number };
    if (count >= 4_096 || node.remaining <= 0) continue;
    const depletion = node.initialAmount > 0 ? node.remaining / node.initialAmount : 1;
    const richness = Math.max(0.28, Math.min(1, (node.initialAmount / 260) * depletion));
    resourceMarkerScratch[cursor] = node.x;
    resourceMarkerScratch[cursor + 1] = node.z;
    resourceMarkerScratch[cursor + 2] = RESOURCE_KIND_INDEX[node.kind];
    resourceMarkerScratch[cursor + 3] = richness;
    cursor += 4;
    count += 1;
  }
  renderer.setGameResourceMarkers(resourceMarkerScratch, count);
}

function packRgb(hex: string): number {
  const value = Number.parseInt(hex.replace('#', ''), 16);
  if (!Number.isFinite(value)) return 0x888888;
  return value & 0xffffff;
}

/** Deterministic 0..1 from a string — used for stable per-unit formation jitter. */
function hashUnit(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/**
 * Rebuild the renderer's army-stack marker buffer from authoritative GameState,
 * fog-gated: own stacks always shown; foreign stacks only when in
 * contact/vision; hidden stacks omitted entirely.
 */
const armyPickScratch: Array<{ id: string; x: number; z: number }> = [];
const previousArmyModelPositions = new Map<string, { x: number; z: number }>();
/** Last rendered facing per army, so the column turns a road corner over a
 *  second or so instead of snapping when the server shifts the leading node. */
const previousArmyHeading = new Map<string, number>();

/** Shortest-arc step from `from` toward `to` (radians), covering `frac` of the gap. */
function dampAngle(from: number, to: number, frac: number): number {
  let delta = to - from;
  delta -= Math.PI * 2 * Math.round(delta / (Math.PI * 2));
  return from + delta * frac;
}

/**
 * Facing for a marching column: a point a short way ahead along the actual road
 * polyline (not the far destination), so the heading already eases toward the
 * next leg before the army reaches a bend. Falls back to the straight-line
 * bearing to the order target. `worldW` handles the x-seam.
 */
function routeLookaheadHeading(
  route: ReadonlyArray<{ x: number; z: number }> | undefined,
  order: { x: number; z: number } | null | undefined,
  fromX: number, fromZ: number, worldW: number,
): number | null {
  const unwrap = (dx: number): number => {
    if (!worldW) return dx;
    if (dx > worldW / 2) return dx - worldW;
    if (dx < -worldW / 2) return dx + worldW;
    return dx;
  };
  if (route && route.length >= 2) {
    const LOOKAHEAD = 16;
    let travelled = 0;
    let px = route[0].x;
    let pz = route[0].z;
    for (let i = 1; i < route.length; i += 1) {
      const dx = unwrap(route[i].x - px);
      const dz = route[i].z - pz;
      const segLen = Math.hypot(dx, dz) || 1;
      if (travelled + segLen >= LOOKAHEAD || i === route.length - 1) {
        const need = Math.min(1, (LOOKAHEAD - travelled) / segLen);
        const aimX = px + dx * need;
        const aimZ = pz + dz * need;
        return Math.atan2(unwrap(aimX - fromX), -(aimZ - fromZ));
      }
      travelled += segLen;
      px += dx;
      pz += dz;
    }
  }
  if (order) return Math.atan2(unwrap(order.x - fromX), -(order.z - fromZ));
  return null;
}

function syncArmyMarkers(
  session: RemoteGameSession, renderer: WorldRenderer,
): void {
  let cursor = 0;
  let count = 0;
  let modelCursor = 0;
  let modelCount = 0;
  let routeCursor = 0;
  let routeCount = 0;
  const activeModelKeys = new Set<string>();
  armyPickScratch.length = 0;
  for (const army of Object.values(session.state.armies)) {
    if (count >= 1_024) break;
    const identified = army.contact === 'visible';

    // Authoritative route polyline for the SELECTED own army only (move = cream,
    // attack = red, retreating = amber). Other armies' routes stay hidden so the
    // map isn't a web of lines; a deselect clears this on the next sync.
    if (army.own && army.id === selectedArmyId && army.moveRoute && army.moveRoute.length >= 2) {
      const colorFlag = army.moveIntent === 'attack' ? 1 : 0;
      const retreatFlag = army.status === 'retreating' ? 1 : 0;
      const emitSegment = (ax: number, az: number, bx: number, bz: number, arrow: number): void => {
        if (routeCount >= 4_096) return;
        routeScratch[routeCursor] = ax;
        routeScratch[routeCursor + 1] = az;
        routeScratch[routeCursor + 2] = bx;
        routeScratch[routeCursor + 3] = bz;
        routeScratch[routeCursor + 4] = colorFlag;
        routeScratch[routeCursor + 5] = 0;
        routeScratch[routeCursor + 6] = retreatFlag;
        routeScratch[routeCursor + 7] = arrow;
        routeCursor += 8;
        routeCount += 1;
      };
      const route = army.moveRoute;
      for (let i = 0; i + 1 < route.length; i += 1) {
        emitSegment(route[i].x, route[i].z, route[i + 1].x, route[i + 1].z, 0);
      }
      // Chevron at the destination, oriented by the final leg tangent, in the
      // route's own colour. Kept small so it never buries the end point.
      const tip = route[route.length - 1];
      const prev = route[route.length - 2];
      const worldW = renderer.manifest?.world.width ?? 0;
      let tx = tip.x - prev.x;
      if (worldW) {
        if (tx > worldW / 2) tx -= worldW;
        else if (tx < -worldW / 2) tx += worldW;
      }
      const tz = tip.z - prev.z;
      const tlen = Math.hypot(tx, tz) || 1;
      const ux = tx / tlen;
      const uz = tz / tlen;
      const WING = 34;
      const COS = Math.cos(2.5); // ~143deg: wings sweep back from the tip
      const SIN = Math.sin(2.5);
      emitSegment(tip.x + WING * (ux * COS - uz * SIN), tip.z + WING * (ux * SIN + uz * COS), tip.x, tip.z, 1);
      emitSegment(tip.x + WING * (ux * COS + uz * SIN), tip.z + WING * (-ux * SIN + uz * COS), tip.x, tip.z, 1);
    }

    const formation = identified ? buildArmyFormation(army.composition?.groups ?? []) : [];
    const compositionRows = identified ? buildArmyCompositionRows(army.composition?.groups ?? []) : [];
    armyMarkerScratch[cursor] = army.x;
    armyMarkerScratch[cursor + 1] = army.z;
    armyMarkerScratch[cursor + 2] = packRgb(army.ownerColor);
    armyMarkerScratch[cursor + 3] = identified ? 1 : 2;
    // Contact markers render as '?'; don't ship the real strength/health.
    armyMarkerScratch[cursor + 4] = identified ? army.composition?.unitCount ?? 0 : 0;
    armyMarkerScratch[cursor + 5] = identified ? army.composition?.health ?? 0 : 0;
    armyMarkerScratch[cursor + 6] = army.id === selectedArmyId ? 1 : 0;
    armyMarkerScratch[cursor + 7] = identified ? dominantVisualKind(formation) : 4;
    for (let row = 0; row < 4; row += 1) {
      armyMarkerScratch[cursor + 8 + row] = compositionRows[row]?.count ?? 0;
      armyMarkerScratch[cursor + 12 + row] = compositionRows[row]?.kind ?? 4;
    }
    cursor += 16;
    count += 1;
    armyPickScratch.push({ id: army.id, x: army.x, z: army.z });

    if (identified && army.id === selectedArmyId && army.artillery && count < 1_024) {
      armyMarkerScratch[cursor] = army.x;
      armyMarkerScratch[cursor + 1] = army.z;
      armyMarkerScratch[cursor + 2] = packRgb(army.ownerColor);
      armyMarkerScratch[cursor + 3] = 3;
      armyMarkerScratch[cursor + 4] = army.artillery.range;
      armyMarkerScratch[cursor + 5] = 0;
      armyMarkerScratch[cursor + 6] = 0;
      armyMarkerScratch[cursor + 7] = 0;
      armyMarkerScratch.fill(0, cursor + 8, cursor + 16);
      cursor += 16;
      count += 1;
    }
    if (army.id === selectedArmyId && army.status === 'engaged' && targetingMode === 'retreat') {
      for (const exit of army.legalRetreatExits ?? []) {
        if (count >= 1_024) break;
        armyMarkerScratch[cursor] = exit.x;
        armyMarkerScratch[cursor + 1] = exit.z;
        armyMarkerScratch[cursor + 2] = packRgb(army.ownerColor);
        armyMarkerScratch[cursor + 3] = 3;
        armyMarkerScratch[cursor + 4] = 18;
        armyMarkerScratch[cursor + 5] = 0;
        armyMarkerScratch[cursor + 6] = 0;
        armyMarkerScratch[cursor + 7] = 0;
        armyMarkerScratch.fill(0, cursor + 8, cursor + 16);
        cursor += 16;
        count += 1;
      }
    }

    if (identified && formation.length) {
      const target = army.moveOrder;
      const marching = Boolean(target);
      // Head along the actual first leg of the authoritative road route (own
      // armies only) so the column sits on the road even where it bends;
      // fall back to a straight line at the destination.
      const route = army.moveRoute;
      const worldW = renderer.manifest?.world.width ?? 0;
      const previousHeading = previousArmyHeading.get(army.id);
      // A stopped army keeps its last facing; a marching one aims a little way
      // along the road and eases toward it, so corners are a turn, not a snap.
      const desiredHeading = routeLookaheadHeading(route, target, army.x, army.z, worldW)
        ?? previousHeading ?? 0;
      const heading = previousHeading === undefined
        ? desiredHeading
        : dampAngle(previousHeading, desiredHeading, marching ? 0.4 : 0.25);
      previousArmyHeading.set(army.id, heading);
      const forwardX = Math.sin(heading);
      const forwardZ = -Math.cos(heading);
      const rightX = Math.cos(heading);
      const rightZ = Math.sin(heading);
      // Two layouts, 0 A.D.-style: a tight box at rest, and a narrow column
      // strung along the heading while marching so the stack hugs the road
      // instead of sprawling across it. A small deterministic per-unit jitter
      // (0 A.D. calls it "sloppiness") keeps it from reading as a rigid grid.
      // Tight so the stack reads as one force sitting on the road, not a mob
      // sprawled across it. Marching = a near-single-file column along the
      // heading with barely any lateral spread; resting = a small loose clump.
      const restSlots: ReadonlyArray<readonly [number, number]> = [
        [-3, -2.6], [3, -1.8], [-2.4, 3], [2.4, 2.8],
      ];
      const marchSlots: ReadonlyArray<readonly [number, number]> = [
        [0, 5.5], [-1.4, 1], [1.4, -2.5], [-0.5, -6],
      ];
      const slots = marching ? marchSlots : restSlots;
      const jitterR = marching ? 0.9 : 1.9;
      const jitterF = marching ? 2.8 : 2.2;
      const armyJitter = hashUnit(army.id);
      for (let index = 0; index < formation.length && modelCount < 4_096; index += 1) {
        const group = formation[index];
        const [slotR, slotF] = slots[index];
        const jr = (hashUnit(`${army.id}:${index}:r`) - 0.5) * jitterR;
        const jf = (hashUnit(`${army.id}:${index}:f`) - 0.5) * jitterF + (armyJitter - 0.5) * 1.5;
        const right = slotR + jr;
        const forward = slotF + jf;
        let x = army.x + rightX * right + forwardX * forward;
        if (renderer.manifest?.world.width) x = ((x % renderer.manifest.world.width) + renderer.manifest.world.width) % renderer.manifest.world.width;
        const z = army.z + rightZ * right + forwardZ * forward;
        const modelKey = `${army.id}:${index}`;
        activeModelKeys.add(modelKey);
        const previous = previousArmyModelPositions.get(modelKey) ?? { x, z };
        let previousX = previous.x;
        const worldWidth = renderer.manifest.world.width;
        if (previousX - x > worldWidth / 2) previousX -= worldWidth;
        else if (x - previousX > worldWidth / 2) previousX += worldWidth;
        armyModelScratch[modelCursor] = x;
        armyModelScratch[modelCursor + 1] = z;
        armyModelScratch[modelCursor + 2] = packRgb(army.ownerColor);
        armyModelScratch[modelCursor + 3] = group.kind;
        armyModelScratch[modelCursor + 4] = group.count;
        armyModelScratch[modelCursor + 5] = group.health;
        armyModelScratch[modelCursor + 6] = army.id === selectedArmyId ? 1 : 0;
        armyModelScratch[modelCursor + 7] = heading;
        armyModelScratch[modelCursor + 8] = previousX;
        armyModelScratch[modelCursor + 9] = previous.z;
        armyModelScratch[modelCursor + 10] = 0;
        // Facing before this update — the shader eases from it to slot +7 over
        // the same window it uses to slide the model, so the turn is smooth
        // between the 2.5 Hz marker syncs.
        armyModelScratch[modelCursor + 11] = previousHeading ?? heading;
        previousArmyModelPositions.set(modelKey, { x, z });
        modelCursor += 12;
        modelCount += 1;
      }
    }
  }
  for (const key of previousArmyModelPositions.keys()) {
    if (!activeModelKeys.has(key)) previousArmyModelPositions.delete(key);
  }
  const activeArmyIds = new Set<string>();
  for (const key of activeModelKeys) activeArmyIds.add(key.slice(0, key.lastIndexOf(':')));
  for (const id of previousArmyHeading.keys()) {
    if (!activeArmyIds.has(id)) previousArmyHeading.delete(id);
  }
  // Rally route for the selected production city only: city node -> rally point
  // along the real road network (server-derived), plus a chevron at the rally
  // end. Hidden the moment the city is deselected.
  if (selectedProvinceId !== null && session.ownsProvince(selectedProvinceId)) {
    const rally = session.rallyPoint(selectedProvinceId);
    const rroute = rally?.route;
    if (rroute && rroute.length >= 2) {
      const worldW = renderer.manifest?.world.width ?? 0;
      const emitRally = (ax: number, az: number, bx: number, bz: number, arrow: number): void => {
        if (routeCount >= 4_096) return;
        routeScratch[routeCursor] = ax;
        routeScratch[routeCursor + 1] = az;
        routeScratch[routeCursor + 2] = bx;
        routeScratch[routeCursor + 3] = bz;
        routeScratch[routeCursor + 4] = 2; // rally colour flag
        routeScratch[routeCursor + 5] = 0;
        routeScratch[routeCursor + 6] = 0;
        routeScratch[routeCursor + 7] = arrow;
        routeCursor += 8;
        routeCount += 1;
      };
      for (let i = 0; i + 1 < rroute.length; i += 1) {
        emitRally(rroute[i].x, rroute[i].z, rroute[i + 1].x, rroute[i + 1].z, 0);
      }
      const tip = rroute[rroute.length - 1];
      const prev = rroute[rroute.length - 2];
      let tdx = tip.x - prev.x;
      if (worldW) {
        if (tdx > worldW / 2) tdx -= worldW;
        else if (tdx < -worldW / 2) tdx += worldW;
      }
      const tdz = tip.z - prev.z;
      const tl = Math.hypot(tdx, tdz) || 1;
      const rx = tdx / tl;
      const rz = tdz / tl;
      const W = 30;
      const C = Math.cos(2.5);
      const S = Math.sin(2.5);
      emitRally(tip.x + W * (rx * C - rz * S), tip.z + W * (rx * S + rz * C), tip.x, tip.z, 1);
      emitRally(tip.x + W * (rx * C + rz * S), tip.z + W * (-rx * S + rz * C), tip.x, tip.z, 1);
    }
  }
  renderer.setArmyMarkers(armyMarkerScratch, count, armyPickScratch, armyModelScratch, modelCount);
  renderer.setOrderRoutes(routeScratch, routeCount);
}

function showGameConfirmation(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'ifg-command-dialog';
    const heading = document.createElement('h2');
    heading.textContent = title;
    const copy = document.createElement('p');
    copy.textContent = message;
    const actions = document.createElement('div');
    actions.className = 'ifg-command-dialog__actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.textContent = 'Confirm';
    confirm.className = 'is-primary';
    const finish = (answer: boolean): void => {
      dialog.close();
      dialog.remove();
      resolve(answer);
    };
    cancel.addEventListener('click', () => finish(false));
    confirm.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(false); });
    actions.append(cancel, confirm);
    dialog.append(heading, copy, actions);
    document.body.append(dialog);
    dialog.showModal();
  });
}

function chooseSplitGroups(session: RemoteGameSession, armyId: string): Promise<Array<{ typeId: string; count: number }> | null> {
  const army = session.army(armyId);
  if (!army?.composition || !army.composition.groups.length) return Promise.resolve(null);
  const groups = army.composition.groups;
  const armyName = army.name;
  const armyUnitCount = army.composition.unitCount;
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'ifg-command-dialog ifg-split-dialog';
    const heading = document.createElement('h2');
    heading.textContent = `Split ${armyName}`;
    const copy = document.createElement('p');
    copy.textContent = 'Choose units for the detachment. At least one unit must remain in the parent.';
    const rows = document.createElement('div');
    const inputs = groups.map((group) => {
      const row = document.createElement('label');
      row.textContent = gameUnitLabel(group.typeId);
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.max = String(group.count);
      input.step = '1';
      input.value = '0';
      row.append(input, document.createTextNode(` / ${group.count}`));
      rows.append(row);
      return { typeId: group.typeId, input };
    });
    const actions = document.createElement('div');
    actions.className = 'ifg-command-dialog__actions';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const confirm = document.createElement('button');
    confirm.type = 'button';
    confirm.textContent = 'Choose destination';
    confirm.className = 'is-primary';
    const finish = (value: Array<{ typeId: string; count: number }> | null): void => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancel.addEventListener('click', () => finish(null));
    confirm.addEventListener('click', () => {
      const selected = inputs.map(({ typeId, input }) => ({
        typeId, count: Math.max(0, Math.trunc(Number(input.value))),
      })).filter((group) => group.count > 0);
      const total = selected.reduce((sum, group) => sum + group.count, 0);
      if (total < 1 || total >= armyUnitCount) {
        copy.textContent = 'The parent and detachment must each contain at least one unit.';
        return;
      }
      finish(selected);
    });
    dialog.addEventListener('cancel', (event) => { event.preventDefault(); finish(null); });
    actions.append(cancel, confirm);
    dialog.append(heading, copy, rows, actions);
    document.body.append(dialog);
    dialog.showModal();
  });
}

// ---- army selection + orders --------------------------

/** A one-shot red reticle that snaps onto the click point and fades. Pure DOM,
 *  no renderer pipeline — the immediate "acknowledged" cue for an attack order. */
let attackFlashEl: HTMLDivElement | null = null;
function flashAttackTarget(clientX: number, clientY: number): void {
  if (!attackFlashEl) {
    attackFlashEl = document.createElement('div');
    attackFlashEl.className = 'ifg-attack-flash';
    attackFlashEl.setAttribute('aria-hidden', 'true');
    document.body.append(attackFlashEl);
  }
  const el = attackFlashEl;
  el.style.left = `${clientX}px`;
  el.style.top = `${clientY}px`;
  el.classList.remove('is-firing');
  void el.offsetWidth; // restart the animation
  el.classList.add('is-firing');
}

function handleMapClick(
  renderer: WorldRenderer, session: RemoteGameSession, clientX: number, clientY: number,
): boolean {
  // 1. Armed destination order -> issue to the clicked ground point.
  if ((targetingMode === 'move' || targetingMode === 'split')
    && selectedArmyId && session.ownsArmy(selectedArmyId)) {
    const ground = renderer.groundPointAt(clientX, clientY);
    if (ground) {
      const result = targetingMode === 'split' && pendingSplitGroups
        ? session.orderSplit(selectedArmyId, pendingSplitGroups, ground[0], ground[1])
        : session.orderMove(selectedArmyId, ground[0], ground[1], 'move');
      if (!result.ok) {
        const { title, body } = describeOrderFailure(result.reason ?? 'No route.');
        pushNotification('warning', targetingMode === 'split' ? 'Split failed' : title, body);
      }
      awaitingMoveTarget = false;
      targetingMode = null;
      pendingSplitGroups = null;
      syncArmyMarkers(session, renderer);
      refreshSelectedArmy(session);
      return true;
    }
  }
  if (targetingMode === 'attack' && selectedArmyId && session.ownsArmy(selectedArmyId)) {
    const targetArmyId = renderer.pickArmyAt(clientX, clientY);
    const pickedTarget = targetArmyId && targetArmyId !== selectedArmyId ? session.army(targetArmyId) : null;
    if (pickedTarget && !pickedTarget.own && pickedTarget.contact !== 'visible') {
      pushNotification('warning', 'Target not identified',
        'Only a force in direct view can be attacked. Move a unit into contact first.');
      targetingMode = null;
      refreshSelectedArmy(session);
      return true;
    }
    // Fired once the server accepts the order — which is *after* any "Declare
    // war?" confirmation but still before combat opens. Do not run it
    // optimistically: a cancelled war declaration must not leave the player
    // told their attack was "issued". Reticle on the target, an order cue and
    // a toast; the optimistic status mutation already reads "advancing".
    const acknowledgeAttack = (): void => {
      flashAttackTarget(clientX, clientY);
      void audio.playUiCue('confirm');
      pushNotification('information', 'Attack order issued',
        'Your force is advancing to engage.');
    };
    const result = targetArmyId && targetArmyId !== selectedArmyId && pickedTarget?.contact === 'visible'
      ? session.orderAttackArmy(selectedArmyId, targetArmyId, acknowledgeAttack)
      : (() => {
        const provinceId = renderer.provinceIdAt(clientX, clientY);
        if (provinceId < 0) {
          return { ok: false as const, reason: 'Aim at an enemy army or a province centre to attack.' };
        }
        if (session.ownsProvince(provinceId)) {
          return { ok: false as const, reason: "That is your own territory — you can't attack it." };
        }
        return session.orderAttackProvince(selectedArmyId!, provinceId, acknowledgeAttack);
      })();
    if (!result.ok) {
      const { title, body } = describeOrderFailure(result.reason ?? 'Invalid target.');
      pushNotification('warning', title, body);
    }
    targetingMode = null;
    syncArmyMarkers(session, renderer);
    refreshSelectedArmy(session);
    return true;
  }
  if (targetingMode === 'retreat' && selectedArmyId && session.ownsArmy(selectedArmyId)) {
    const ground = renderer.groundPointAt(clientX, clientY);
    const exits = session.army(selectedArmyId)?.legalRetreatExits ?? [];
    if (ground && exits.length) {
      const selected = [...exits].sort((a, b) =>
        Math.hypot(a.x - ground[0], a.z - ground[1])
        - Math.hypot(b.x - ground[0], b.z - ground[1]))[0];
      const result = session.orderRetreat(selectedArmyId, selected.firstNodeId);
      if (!result.ok) pushNotification('warning', 'Retreat', result.reason ?? 'No legal retreat.');
      targetingMode = null;
      refreshSelectedArmy(session);
      syncArmyMarkers(session, renderer);
      return true;
    }
  }
  // 1b. Armed rally placement -> set the selected province's rally point.
  if (awaitingRallyTarget && selectedProvinceId !== null && session.ownsProvince(selectedProvinceId)) {
    const ground = renderer.groundPointAt(clientX, clientY);
    if (ground) {
      session.setRally(selectedProvinceId, ground[0], ground[1]);
      awaitingRallyTarget = false;
      pushNotification('information', 'Rally point set', 'New units from here will march to it.');
      refreshSelectedProvince(session);
      return true;
    }
  }
  // 2. Otherwise, army pick.
  const hit = renderer.pickArmyAt(clientX, clientY);
  if (hit) {
    selectArmy(session, hit);
    return true;
  }
  // 3. Nothing — let province selection proceed, and drop any army selection.
  if (selectedArmyId) deselectArmy();
  return false;
}

/**
 * Turn a raw server/engine rejection reason into a concise headline + detail so
 * the player learns *why* an order failed instead of seeing "Command failed".
 */
function describeOrderFailure(reason: string): { title: string; body?: string } {
  const r = reason.toLowerCase();
  if (r.includes('not your army')) return { title: 'Not your army', body: 'You can only order armies you command.' };
  if (r.includes('not your province')) return { title: 'Not your province', body: reason };
  if (r.includes('own force') || r.includes('own territory') || r.includes('already hold that province')) {
    return { title: 'Invalid target', body: 'You cannot attack your own forces or territory.' };
  }
  if (r.includes('close combat') || r.includes('is engaged')) return { title: 'Army is fighting', body: 'It cannot take new orders until the battle ends.' };
  if (r.includes('retreating')) return { title: 'Army is retreating', body: 'Wait for it to disengage before giving new orders.' };
  if (r.includes('war declaration')) return { title: 'War not declared', body: 'That route crosses a country you are not at war with.' };
  if (r.includes('separate landmass')) return { title: 'Unreachable', body: reason };
  if (r.includes('off the road network') || r.includes('not on land')) return { title: 'No path there', body: reason };
  if (r.includes('no legal route') || r.includes('no land route')) return { title: 'No route', body: reason };
  if (r.includes('already there')) return { title: 'Already there', body: 'The army is already at that location.' };
  if (r.includes('retreat direction')) return { title: 'Bad retreat', body: reason };
  if (r.includes('not in close combat')) return { title: 'Not in combat', body: 'Only an engaged army can be ordered to retreat.' };
  return { title: 'Order rejected', body: reason };
}

/**
 * Right-click order for the selected army: attack a visible hostile army under
 * the cursor, otherwise move to the ground point. War confirmation and routing
 * rules are the same ones the armed Move/Attack buttons use — this is just a
 * faster way to reach them.
 */
function handleMapCommand(
  renderer: WorldRenderer, session: RemoteGameSession, clientX: number, clientY: number,
): boolean {
  if (!selectedArmyId || !session.ownsArmy(selectedArmyId)) return false;
  // A direct order supersedes any armed targeting mode.
  targetingMode = null;
  awaitingMoveTarget = false;
  pendingSplitGroups = null;

  const orderFeedback = (reason: string): void => {
    const { title, body } = describeOrderFailure(reason);
    pushNotification('warning', title, body);
  };

  const targetArmyId = renderer.pickArmyAt(clientX, clientY);
  if (targetArmyId && targetArmyId !== selectedArmyId) {
    const target = session.army(targetArmyId);
    if (target && !target.own && target.contact === 'visible') {
      const result = session.orderAttackArmy(selectedArmyId, targetArmyId);
      if (!result.ok) orderFeedback(result.reason ?? 'Invalid target.');
      refreshSelectedArmy(session);
      if (activeRenderer) syncArmyMarkers(session, activeRenderer);
      return true;
    }
    if (target && !target.own) {
      // An unidentified contact: don't strike it (that would confirm its exact
      // position) and don't silently march onto it either.
      pushNotification('warning', 'Target not identified',
        'Only a force in direct view can be attacked. Move a unit into contact first.');
      return true;
    }
  }

  const ground = renderer.groundPointAt(clientX, clientY);
  if (!ground) {
    pushNotification('warning', 'No path there', 'Right-click on your own territory or a discovered area to move.');
    return true;
  }
  const result = session.orderMove(selectedArmyId, ground[0], ground[1], 'move');
  if (!result.ok) orderFeedback(result.reason ?? 'No route.');
  refreshSelectedArmy(session);
  if (activeRenderer) syncArmyMarkers(session, activeRenderer);
  return true;
}

function selectArmy(session: RemoteGameSession, armyId: string): void {
  selectedArmyId = armyId;
  awaitingMoveTarget = false;
  targetingMode = null;
  pendingSplitGroups = null;
  awaitingRallyTarget = false;
  renderer_clearProvince();
  refreshSelectedArmy(session);
  if (activeRenderer) syncArmyMarkers(session, activeRenderer);
}

function deselectArmy(): void {
  selectedArmyId = null;
  awaitingMoveTarget = false;
  targetingMode = null;
  pendingSplitGroups = null;
  uiStore.patch({ selectedArmy: null });
  if (activeSession && activeRenderer) {
    syncArmyMarkers(activeSession, activeRenderer);
  }
}

function renderer_clearProvince(): void {
  activeRenderer?.clearProvinceSelection();
}

function handleArmyCommand(command: ArmyPanelCommand): void {
  const session = activeSession;
  if (!session || !selectedArmyId) { if (command === 'deselect') deselectArmy(); return; }
  if (command === 'deselect') { deselectArmy(); return; }
  if (command === 'move') {
    targetingMode = 'move'; awaitingMoveTarget = true; refreshSelectedArmy(session); return;
  }
  if (command === 'attack') {
    targetingMode = 'attack'; awaitingMoveTarget = false; refreshSelectedArmy(session); return;
  }
  if (command === 'split') {
    void chooseSplitGroups(session, selectedArmyId).then((groups) => {
      if (!groups || !selectedArmyId) return;
      pendingSplitGroups = groups;
      targetingMode = 'split';
      awaitingMoveTarget = false;
      refreshSelectedArmy(session);
    });
    return;
  }
  if (command === 'retreat' || command.startsWith('retreat:')) {
    const view = session.army(selectedArmyId);
    const exits = view?.legalRetreatExits ?? [];
    const explicit = command.startsWith('retreat:') ? Number(command.slice('retreat:'.length)) : null;
    const firstNodeId = explicit ?? (exits.length === 1 ? exits[0].firstNodeId : null);
    if (firstNodeId === null) {
      targetingMode = 'retreat';
      pushNotification('information', 'Choose retreat direction', 'Select one of the highlighted exit edges on the map.');
      refreshSelectedArmy(session);
      if (activeRenderer) syncArmyMarkers(session, activeRenderer);
      return;
    }
    const result = session.orderRetreat(selectedArmyId, firstNodeId);
    if (!result.ok) pushNotification('warning', 'Retreat', result.reason ?? 'No legal retreat.');
    targetingMode = null;
    refreshSelectedArmy(session);
    if (activeRenderer) syncArmyMarkers(session, activeRenderer);
    return;
  }
  if (command === 'stop') {
    session.orderStop(selectedArmyId);
    awaitingMoveTarget = false;
    targetingMode = null;
    refreshSelectedArmy(session);
    return;
  }
  if (command === 'extract') {
    const result = session.orderExtract(selectedArmyId);
    if (!result.ok) pushNotification('warning', 'Extract', result.reason ?? 'Cannot extract here.');
    else pushNotification('information', 'Extraction started', 'Deposit is now feeding your stockpile.');
    refreshSelectedArmy(session);
  }
}

function refreshSelectedArmy(
  session: RemoteGameSession,
): void {
  if (!selectedArmyId) { if (uiStore.get().selectedArmy) uiStore.patch({ selectedArmy: null }); return; }
  // Everything the card shows comes from the fog-aware projection — the raw
  // ArmyStack (exact groups / hp / speed) never reaches the HUD for a foreign
  // stack the player has not fully identified.
  const view = session.army(selectedArmyId);
  if (!view) { deselectArmy(); return; } // gone, or degraded to hidden
  const comp = view.composition;
  const combat = view.status === 'moving' ? 'moving'
    : view.status === 'engaged' ? 'engaged'
    : view.status === 'retreating' ? 'retreating' : 'idle';
  const groups = comp?.groups.map((g) => ({
    typeId: g.typeId, label: gameUnitLabel(g.typeId), count: g.count, health: g.health,
  }));
  const activity = armyActivityLabel(view.status, awaitingMoveTarget, view.own);
  uiStore.patch({
    selectedArmy: {
      id: view.id,
      country: view.ownerName,
      countryColor: view.ownerColor,
      name: view.name,
      identified: comp !== null,
      unitCount: comp?.unitCount ?? 0,
      strength: comp ? Math.min(1, comp.unitCount / 12) : 0,
      health: comp?.health ?? 0,
      selected: true,
      combat,
      moveOrder: view.moveOrder,
      groups,
      speed: comp?.speed,
      attack: aggregateTroopStat(groups, 'attack', gameUnit),
      defense: aggregateTroopStat(groups, 'defense', gameUnit),
      activity,
      own: view.own,
      canExtract: view.own && !view.moveOrder && session.extractableNodeAt(view.id) !== null,
      awaitingMoveTarget: view.own && awaitingMoveTarget,
      targetingMode: view.own ? targetingMode : null,
      canMove: view.own && view.status !== 'engaged' && view.status !== 'retreating',
      canAttack: view.own && view.status !== 'engaged' && view.status !== 'retreating',
      canRetreat: view.own && view.status === 'engaged' && Boolean(view.legalRetreatExits?.length),
      canSplit: view.own && view.status !== 'engaged' && view.status !== 'retreating',
      canStop: view.own && view.status !== 'engaged' && view.status !== 'retreating'
        && (Boolean(view.moveOrder) || view.status === 'extracting' || targetingMode !== null),
      simulationTick: session.state.simulationTick,
      legalRetreatExits: view.legalRetreatExits,
      battleFronts: view.battleFronts,
      artillery: view.artillery,
    },
  });
}

/** Build the province card from fog-aware GameState + the renderer-supplied
 *  name/terrain for `provinceId` (which must be the selected province). */
function projectSelectedProvince(
  session: RemoteGameSession, provinceId: number,
): import('./ui/ui-state').SelectedProvince {
  const summary = session.describeProvince(provinceId);
  return {
    id: provinceId,
    name: selectedProvinceName,
    owner: summary.ownerName,
    ownerColor: summary.ownerColor,
    terrain: selectedProvinceTerrain,
    resources: summary.resources,
    isOwn: summary.isOwn,
    coastal: false,
    buildings: summary.isOwn
      ? ((session.state.provinceBuildings[provinceId] as {
          barracks: number; tankPlant: number; ordnance: number;
        } | undefined) ?? { barracks: 0, tankPlant: 0, ordnance: 0 })
      : null,
    deposits: summary.resources
      ? { controlled: summary.controlled, extracting: summary.extracting }
      : null,
    producible: summary.isOwn
      ? session.producible(provinceId).map((id) => ({
          id, name: gameUnitLabel(id), costLabel: unitCostLabel(id),
        }))
      : [],
    // Only the head order is being worked; it carries live progress/eta.
    queue: summary.isOwn
      ? (session.state.productionQueues[provinceId] as Array<{ unitTypeId: string; progressHours: number; totalHours: number }> ?? []).map((o, i) => ({
          id: o.unitTypeId, label: gameUnitLabel(o.unitTypeId), active: i === 0,
          progress: i === 0 ? orderPercent(o) / 100 : 0, etaSeconds: i === 0 ? orderEtaSeconds(o) : 0,
        }))
      : [],
    buildable: summary.isOwn
      ? session.buildable(provinceId).map(({ id, affordable }) => ({
          id, name: buildingLabel(id), costLabel: buildingCostLabel(id), affordable,
        }))
      : [],
    construction: summary.isOwn
      ? (session.state.constructionQueues[provinceId] as Array<{ buildingId: BuildingId; progressHours: number; totalHours: number }> ?? []).map((o, i) => ({
          id: o.buildingId, label: buildingLabel(o.buildingId), active: i === 0,
          progress: i === 0 ? orderPercent(o) / 100 : 0, etaSeconds: i === 0 ? orderEtaSeconds(o) : 0,
        }))
      : [],
    rally: summary.isOwn ? session.rallyPoint(provinceId) : null,
    awaitingRallyTarget: summary.isOwn && awaitingRallyTarget && selectedProvinceId === provinceId,
  };
}

/** Re-project the province card in place — used after a capture flips the
 *  selected province's owner, so it doesn't need a reselect to update. */
function refreshSelectedProvince(session: RemoteGameSession): void {
  if (selectedProvinceId === null) return;
  if (uiStore.get().selectedProvince?.id !== selectedProvinceId) return;
  uiStore.patch({ selectedProvince: projectSelectedProvince(session, selectedProvinceId) });
}

/** Global spacing so several battles opening at once cannot stack the alert
 *  cue into a wall of noise (the server already fires 'engaged' once per
 *  battle, so this is the only extra guard needed). */
let lastCombatAlertAt = 0;
function maybePlayCombatAlert(): void {
  const now = Date.now();
  if (now - lastCombatAlertAt < 3_000) return;
  lastCombatAlertAt = now;
  void audio.playCombatAlert();
}

/**
 * Reconcile one persistent battle marker per engaged cluster (armies grouped to
 * a ~70u grid so two stacks trading fire share a marker). The marker's compass
 * direction points at the nearest engaged enemy stack.
 */
function syncCombatMarkers(session: RemoteGameSession): void {
  const engaged = Object.values(session.state.armies).filter((a) => a.status === 'engaged');
  const seen = new Map<string, { id: string; x: number; z: number; intensity: number; dir: number }>();
  for (const a of engaged) {
    const key = `${Math.round(a.x / 70)}:${Math.round(a.z / 70)}`;
    if (seen.has(key)) continue;
    let dir = Number.NaN;
    let best = Number.POSITIVE_INFINITY;
    for (const other of engaged) {
      if (other === a || other.ownerCountryId === a.ownerCountryId) continue;
      const d = (other.x - a.x) ** 2 + (other.z - a.z) ** 2;
      if (d < best) { best = d; dir = Math.atan2(other.z - a.z, other.x - a.x); }
    }
    seen.set(key, { id: key, x: a.x, z: a.z, intensity: 1, dir });
  }
  combatEffects.syncBattles([...seen.values()]);
}

function drainSessionEvents(session: RemoteGameSession): void {
  const player = session.playerCountryId;
  for (const done of session.pendingCompletions.splice(0)) {
    // Only the player's own production is player news.
    if (session.state.provinceOwners[done.provinceId] !== player) continue;
    const name = gameUnitLabel(done.unitTypeId);
    pushNotification('completed', `${name} ready`, 'Reinforcements have joined the line.');
  }
  for (const done of session.pendingBuildings.splice(0)) {
    if (session.state.provinceOwners[done.provinceId] !== player) continue;
    pushNotification('completed', `${buildingLabel(done.buildingId)} complete`,
      'The site is operational.');
    if (selectedProvinceId === done.provinceId) refreshSelectedProvince(session);
  }
  // A world spot for a fight between two countries: the first engaged stack we
  // can see that belongs to either side. null when neither is visible.
  const battleSpotFor = (a: number, b: number): { x: number; z: number } | null => {
    for (const army of Object.values(session.state.armies)) {
      if (army.status !== 'engaged') continue;
      if (army.ownerCountryId === a || army.ownerCountryId === b) return { x: army.x, z: army.z };
    }
    return null;
  };
  const fxDensity = effectDensityForDistance(lastCombatCameraDistance);
  for (const ev of session.pendingCombat.splice(0)) {
    // Only fights the player is in are player news. 'engaged' is gated to the
    // moment contact is made, so it fires once per battle, not every tick.
    if (ev.attacker !== player && ev.defender !== player) continue;
    const mine = ev.defender === player;
    // World-space visuals for the same event, near-camera only (LOD gated).
    if (fxDensity > 0) {
      const atkSpot = battleSpotFor(ev.attacker, ev.attacker);
      const defSpot = battleSpotFor(ev.defender, ev.defender) ?? battleSpotFor(ev.attacker, ev.defender);
      const spot = defSpot ?? atkSpot;
      const dir = atkSpot && defSpot
        ? Math.atan2(defSpot.z - atkSpot.z, defSpot.x - atkSpot.x)
        : Number.NaN;
      if (spot) {
        if (ev.kind === 'engaged') {
          combatEffects.spawnVolley('generic', spot.x, spot.z, Number.isFinite(dir) ? dir : 0);
          if (mine) combatEffects.spawn(EFFECT_KIND.targetFlash, spot.x, spot.z, { scale: 1.1 });
        } else if (ev.kind === 'volley') {
          combatEffects.spawnVolley('infantry', spot.x, spot.z, Number.isFinite(dir) ? dir : 0);
        } else if (ev.kind === 'bombardment') {
          if (atkSpot) {
            combatEffects.spawnVolley('artillery', atkSpot.x, atkSpot.z, Number.isFinite(dir) ? dir : 0);
          }
          const impactAt = defSpot ?? spot;
          window.setTimeout(() => {
            combatEffects.spawn(EFFECT_KIND.explosion, impactAt.x, impactAt.z, { scale: 1.3 });
            combatEffects.spawn(EFFECT_KIND.smoke, impactAt.x, impactAt.z, { scale: 1.2, lifetimeMs: 2_400 });
          }, 520);
        } else if (ev.kind === 'destroyed') {
          combatEffects.spawn(EFFECT_KIND.explosion, spot.x, spot.z, { scale: 1.5 });
          combatEffects.spawn(EFFECT_KIND.smoke, spot.x, spot.z, { scale: 1.6, lifetimeMs: 2_800 });
        }
      }
    }
    if (ev.kind === 'engaged') {
      // Locate the fight on one of the player's engaged stacks so the toast can
      // jump the camera there. 'engaged' fires once per battle server-side, so
      // the only client-side guard needed is a global alert-sound cooldown.
      const spot = mine
        ? Object.values(session.state.armies).find((a) => a.own && a.status === 'engaged')
        : undefined;
      pushNotification('combat', mine ? 'Force under attack' : 'Contact',
        mine ? 'Enemy forces have engaged your line.' : 'Your forces have made contact.',
        spot ? { focus: { x: spot.x, z: spot.z } } : {});
      if (mine) maybePlayCombatAlert();
    } else if (ev.kind === 'retreat') {
      pushNotification('combat', mine ? 'Forces withdrawing' : 'Enemy in retreat',
        mine ? 'A battered stack is pulling back to friendly ground.'
          : 'An enemy stack has broken off and is falling back.');
    } else if (ev.kind === 'destroyed') {
      pushNotification('combat', mine ? 'Stack destroyed' : 'Enemy stack destroyed',
        mine ? 'One of your armies has been wiped out.' : 'You have annihilated an enemy army.');
    } else if (ev.kind === 'bombardment') {
      pushNotification('combat', mine ? 'Under bombardment' : 'Artillery firing',
        mine ? 'Enemy artillery has struck one of your armies.' : 'Your artillery has fired a volley.');
    } else if (ev.kind === 'reinforced') {
      pushNotification('combat', 'Battle reinforced', 'Another army has joined an active direction.');
    } else if (ev.kind === 'battleEnded') {
      pushNotification('information', 'Battle ended', 'Surviving armies are resuming valid orders.');
    }
  }
  for (const cap of session.pendingCaptures.splice(0)) {
    // One-way projection: push the authoritative owner change onto the renderer
    // (political colour, borders, labels, hover ownership) for EVERY capture,
    // not just the player's, so the political map can't diverge from GameState
    //. The renderer stays a presentation cache.
    try {
      activeRenderer?.setProvinceOwner(cap.provinceId, cap.toCountryId);
    } catch (err) {
      console.warn('[game] capture → renderer ownership projection failed', cap, err);
    }
    if (selectedProvinceId === cap.provinceId) refreshSelectedProvince(session);
    // Only surface captures the player is involved in.
    if (cap.toCountryId !== player && cap.fromCountryId !== player) continue;
    const to = session.state.countries[cap.toCountryId]?.name ?? '?';
    const from = session.state.countries[cap.fromCountryId]?.name ?? '?';
    pushNotification('combat',
      cap.toCountryId === player ? 'Province captured' : 'Province lost',
      `${to} took a province from ${from}.`);
  }
}

/** "Now Playing" chip. Driven only by MusicDirector.onTrackChange, which fires
 *  after playback actually succeeds — so a blocked autoplay never shows a title. */
const nowPlayingEl = document.getElementById('now-playing');
const nowPlayingTitleEl = document.getElementById('now-playing-title');
let nowPlayingHideTimer: number | undefined;
function updateNowPlaying(title: string | null): void {
  if (!nowPlayingEl || !nowPlayingTitleEl) return;
  if (nowPlayingHideTimer !== undefined) { window.clearTimeout(nowPlayingHideTimer); nowPlayingHideTimer = undefined; }
  if (!title) { nowPlayingEl.hidden = true; return; }
  nowPlayingTitleEl.textContent = title;
  nowPlayingEl.hidden = false;
  nowPlayingEl.classList.add('is-changing');
  window.setTimeout(() => nowPlayingEl.classList.remove('is-changing'), 2_600);
}

/** id -> auto-dismiss timer handle. Cleared on manual dismiss and on teardown. */
const notificationTimers = new Map<string, number>();

function clearNotificationTimer(id: string): void {
  const timer = notificationTimers.get(id);
  if (timer !== undefined) { window.clearTimeout(timer); notificationTimers.delete(id); }
}

/** Remove one notification by id (not by title) and clear its timer. */
function removeNotification(id: string): void {
  clearNotificationTimer(id);
  const next = uiStore.get().notifications.filter((entry) => entry.id !== id);
  if (next.length !== uiStore.get().notifications.length) uiStore.patch({ notifications: next });
}

function clearAllNotificationTimers(): void {
  for (const timer of notificationTimers.values()) window.clearTimeout(timer);
  notificationTimers.clear();
}

function pushNotification(
  kind: GameNotification['kind'], title: string, body?: string,
  options: { sticky?: boolean; focus?: { x: number; z: number } } = {},
): void {
  const id = `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const sticky = isSticky(kind, options.sticky);
  const previous = uiStore.get().notifications;
  const notifications = [...previous, { id, kind, title, body, at: Date.now(), sticky, focus: options.focus }].slice(-4);
  // Anything the last-4 cap just dropped no longer needs its auto-dismiss timer.
  const kept = new Set(notifications.map((entry) => entry.id));
  for (const entry of previous) if (!kept.has(entry.id)) clearNotificationTimer(entry.id);
  uiStore.patch({ notifications });
  const delay = autoDismissDelay(kind, options.sticky);
  if (delay !== null) {
    notificationTimers.set(id, window.setTimeout(() => removeNotification(id), delay));
  }
}

/**
 * Map the player country's authoritative stockpile onto the HUD's physical
 * stockpile row: Funds · Manpower · Food · Stone · Metal · Oil. Industry
 * Capacity is a throughput stat, not a stockpile — it belongs in the economy
 * panel, not this row.
 */
function playerResourceLines(session: RemoteGameSession): ResourceLine[] {
  const country = session.ownCountry;
  const s = country.stockpile;
  const inc = country.income;
  // Live extraction rate per game hour for stone/metal/oil (0 when nothing is
  // being extracted). Server-projected; `?? 0` covers an older projection.
  const ext = (country.extraction ?? {}) as Partial<Record<'stone' | 'metal' | 'oil', number>>;
  const line = (
    id: ResourceLine['id'], label: string, value: number, delta?: number,
  ): ResourceLine => ({
    id, label, value: Math.round(value),
    delta: delta === undefined ? undefined : Number(delta.toFixed(1)),
  });
  return [
    line('money', 'Funds', s.funds, inc.funds),
    line('manpower', 'Manpower', s.manpower, inc.manpower),
    line('food', 'Food', s.food, inc.food),
    // stone/metal/oil have no passive income — the rate is current extraction.
    line('stone', 'Stone', s.stone, ext.stone ?? 0),
    line('metal', 'Metal', s.metal, ext.metal ?? 0),
    line('oil', 'Oil', s.oil, ext.oil ?? 0),
  ];
}

function renderDiplomacyState(renderer: WorldRenderer, state: DiplomacyState): void {
  debugPlayerCountry.textContent = state.player.name;
  debugCountryFlag.style.setProperty('--player-country-color', state.player.color);
  renderRelationList(renderer, debugWarList, state.enemies, 'No wars');
  renderRelationList(renderer, debugAlliedList, state.allies, 'No allies');
}

function renderRelationList(
  renderer: WorldRenderer,
  container: HTMLElement,
  countries: CountryRecord[],
  emptyLabel: string,
): void {
  if (!countries.length) {
    const empty = document.createElement('span');
    empty.className = 'relation-list__empty';
    empty.textContent = emptyLabel;
    container.replaceChildren(empty);
    return;
  }
  container.replaceChildren(...countries.map((country) => {
    const chip = document.createElement('span');
    chip.className = 'relation-chip';
    chip.append(country.name);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.title = `Remove ${country.name}`;
    remove.setAttribute('aria-label', `Remove ${country.name}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      renderer.clearDiplomaticRelation(country.id);
      setDiplomacyStatus(`${country.name} is neutral again.`);
    });
    chip.append(remove);
    return chip;
  }));
}

function setDiplomacyStatus(message: string, error = false): void {
  debugDiplomacyStatus.textContent = message;
  debugDiplomacyStatus.classList.toggle('is-error', error);
}

// Deposit abundance, not production/day. Icon art only, at most three chips,
// row hidden when the province holds nothing.
const RESOURCE_TOOLTIP_CHIPS = [
  ['stone', 'node-stone'], ['metal', 'node-metal'], ['oil', 'node-oil'],
] as const;

function updateTooltip(
  info: HoverInfo | null, x: number, y: number, resources: ProvinceResources | null,
): void {
  if (!info) {
    tooltip.hidden = true;
    return;
  }
  tooltipName.textContent = info.name;
  tooltipTerrain.textContent = `${info.country} · ${info.terrain}`;
  const chips = resources
    ? RESOURCE_TOOLTIP_CHIPS
        .filter(([key]) => resources[key] > 0)
        .map(([key, icon]) =>
          `<span class="tooltip-rchip">${iconMarkup(icon)}${compactNumber.format(resources[key])}</span>`)
    : [];
  tooltipResources.hidden = chips.length === 0;
  tooltipResources.innerHTML = chips.join('');
  tooltip.style.setProperty('--country-color', info.countryColor);
  tooltip.style.left = `${x}px`;
  tooltip.style.top = `${y}px`;
  tooltip.hidden = false;
}

function updateDiagnostics(stats: FrameStats): void {
  diagnosticsStats.textContent = [
    `${stats.fps.toFixed(0).padStart(3)} FPS  ${stats.frameMs.toFixed(1).padStart(5)} ms`,
    `map  ${stats.camera[0].toFixed(0).padStart(5)}, ${stats.camera[1].toFixed(0).padStart(4)}`,
    `alt  ${stats.camera[2].toFixed(0).padStart(5)}   zoom ${stats.distance.toFixed(0)}`,
    `target    ${stats.targetProvince ?? 'water'} @ ${stats.targetElevation.toFixed(2)}`,
    `province  ${stats.hoveredProvince ?? '—'}`,
    activeRenderer
      ? `graphics  ${activeRenderer.graphicsQuality} @ ${activeRenderer.effectiveRenderScale.toFixed(2)}x  ${canvas.width}x${canvas.height}`
      : 'graphics  —',
    activeRenderer
      ? (() => {
        const q = activeRenderer.qualityReadout;
        return `preset    prop ${q.propDistanceScale.toFixed(2)}x  lod ${q.terrainLodScale.toFixed(2)}x  detail ${q.detailFactor.toFixed(2)}  furniture ${q.furniture ? 'on' : 'off'}`;
      })()
      : 'preset    —',
    activeRenderer
      ? (() => {
        const q = activeRenderer.qualityReadout;
        return `budgets   trees ${q.treeBudget.toLocaleString()}  bldg ${q.buildingBudget.toLocaleString()}  3D army <${q.armyModelRange}u (${q.armyModelCount} now)`;
      })()
      : 'budgets   —',
    `trees     ${stats.trees.toLocaleString()}`,
    `buildings ${stats.buildings.toLocaleString()}`,
    `roads     ${stats.emittedRoads.toLocaleString()} + ${stats.hiddenRoads} dotted`,
    `rivers    ${stats.riverSystems} systems / ${stats.riverSegments} edges`,
    `canals    ${stats.canalSegments} edges`,
    `borders   ${stats.borderEdges.toLocaleString()}`,
  ].join('\n');

  const timing = stats.performance;
  const phaseRanking = Object.entries(timing.phases)
    .sort(([, a], [, b]) => b.average - a.average)
    .slice(0, 3)
    .map(([name, values]) => `${name} ${values.average.toFixed(2)}`)
    .join('  ');
  const geometryRanking = Object.entries(timing.workload.trianglesByCategory)
    .filter(([, triangles]) => triangles > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([name, triangles]) => `${name} ${formatCompact(triangles)}`)
    .join('  ');
  const browserPerformance = performance as Performance & {
    memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number };
  };
  const memory = browserPerformance.memory;
  diagnosticsPerformance.textContent = [
    `frame  avg ${timing.frame.average.toFixed(2)}  p95 ${timing.frame.p95.toFixed(2)}  max ${timing.frame.maximum.toFixed(1)} ms`,
    `CPU    avg ${timing.mainThread.average.toFixed(2)}  p95 ${timing.mainThread.p95.toFixed(2)} ms`,
    timing.gpu
      ? `GPU    avg ${timing.gpu.average.toFixed(2)}  p95 ${timing.gpu.p95.toFixed(2)} ms  n=${timing.gpuSampleCount}`
      : `GPU    timestamp ${timing.gpuTimingSupported ? 'warming up' : 'unavailable'}`,
    `hot CPU  ${phaseRanking || 'collecting samples'}`,
    `draws  ${timing.workload.drawCalls}   instances ${formatCompact(timing.workload.instances)}`,
    `tris   ${formatCompact(timing.workload.triangles)}   labels ${timing.workload.labels}`,
    `hot geo  ${geometryRanking || 'none'}`,
    `chunks terrain ${timing.workload.visibleChunks.terrain}  trees ${timing.workload.visibleChunks.trees}  buildings ${timing.workload.visibleChunks.buildings}`,
    `chunks road ${timing.workload.visibleChunks.roads}  river ${timing.workload.visibleChunks.waterways}  border ${timing.workload.visibleChunks.borders}  links ${timing.workload.visibleChunks.hiddenLinks}`,
    `LOD terrain ${timing.workload.lodInstances.terrain.join('/')}  trees ${timing.workload.lodInstances.trees.join('/')}  buildings ${timing.workload.lodInstances.buildings.join('/')}`,
    memory ? `JS heap ${formatBytes(memory.usedJSHeapSize)} / ${formatBytes(memory.jsHeapSizeLimit)}` : 'JS heap unavailable',
  ].join('\n');
}

function formatCompact(value: number): string {
  return compactNumber.format(value);
}

function formatBytes(value: number): string {
  return `${(value / 1_048_576).toFixed(1)} MB`;
}

const DEBUG_HELP: Record<number, { description: string; legend: Array<[string, string]> }> = {
  0: { description: 'Normal rendered world.', legend: [] },
  1: { description: 'Normalized final terrain elevation after topology conditioning.', legend: [['low', '#151b1d'], ['high', '#f2f2ee']] },
  2: { description: 'Authored terrain classes used by topography and placement.', legend: [['plain', '#65ad52'], ['hill', '#ab943f'], ['mountain', '#94918c'], ['forest', '#1f6b33']] },
  3: { description: 'Deterministic color per province for geometry and adjacency inspection.', legend: [['province', '#c880d4']] },
  4: { description: 'Final heightfield normals; abrupt color changes reveal terrain discontinuities.', legend: [['normal XYZ', '#8ab9dc']] },
  5: { description: 'Terrain steepness heatmap for finding cliffs, harsh passes, and topology artifacts.', legend: [['gentle', '#145038'], ['steep', '#f43814']] },
  6: { description: 'Waterway overlay mask used for draped rivers, placement clearance, and border routing.', legend: [['river', '#05efff'], ['canal', '#f9b71a']] },
  7: { description: 'Static land/coast classification and open-water depth.', legend: [['land', '#299e4c'], ['coast', '#bd6b29'], ['deep water', '#041c47']] },
  8: { description: 'Full dirt-road core and verge footprint independent of nearby 3D geometry.', legend: [['verge', '#ef9e1a'], ['core', '#f22e14']] },
  9: { description: 'Navigation composite for comparing roads, static water, rivers, and canals.', legend: [['road', '#f59c1e'], ['river', '#05c7f9'], ['canal', '#c46bf5'], ['ocean/lake', '#062e66']] },
};

function updateDebugHelp(mode: number): void {
  const help = DEBUG_HELP[mode] ?? DEBUG_HELP[0];
  debugDescription.textContent = help.description;
  debugLegend.replaceChildren(...help.legend.map(([label, color]) => {
    const item = document.createElement('span');
    const swatch = document.createElement('i');
    swatch.style.setProperty('--legend', color);
    item.append(swatch, label);
    return item;
  }));
}

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element #${id}`);
  return element as T;
}

function isMapMode(value: string): value is MapMode {
  return value === 'political' || value === 'diplomacy' || value === 'clear' || value === 'balanced';
}

const DEMO_NOTIFICATIONS: readonly GameNotification[] = [
  { id: 'demo-info', kind: 'information', title: 'Operation underway', body: 'Command HUD preview build.', at: 0 },
  { id: 'demo-diplo', kind: 'diplomacy', title: 'Diplomatic channel open', body: 'Placeholder event fixture.', at: 0 },
  { id: 'demo-warn', kind: 'warning', title: 'Supply line exposed', at: 0 },
];
