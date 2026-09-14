import { setDebugHandles } from './client/debug-access';
import { describeOrderFailure } from './ui/order-feedback';
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
  type DiplomacyBusyAction, type DiplomacyCountryView, type DiplomacyMessageView,
  type DiplomacyProposalView, type DiplomacyView,
  type TechnologyBranch,
} from './ui/ui-state';
import { autoDismissDelay, isSticky } from './ui/notification-lifecycle';
import { DEMO_ARMY, type ArmyPanelCommand } from './ui/army';
import { aggregateTroopStat, armyActivityLabel } from './ui/army-presentation';
import { iconMarkup } from './ui/icons';
import type { WorldRenderer, MapMode, TimeOfDayState } from './renderer';
import type { FrameStats, HoverInfo } from './types';
import { LOADING_QUOTES } from './loadingQuotes';
import { getGame, getSession, joinGame, logout } from './client/auth-api';
import { GameConnection } from './client/game-connection';
import { RemoteGameSession } from './client/remote-session';
import { configureWorldAssetBase, verifyWorldDescriptor } from './world-assets';
import { CombatEffectPool, EFFECT_KIND, effectDensityForDistance } from './combat-effects';
import type { SessionResponse } from '@ironfronts/protocol';
import { buildArmyCompositionRows, buildArmyFormation } from './army-map-presentation';
import { ArmyMotionInterpolator, type ArmyPickEntry } from './army-motion';
import { buildBattleAnchors, combatHuddleOffset, groupEngagedByFront } from './combat-huddle';
import { MISSILE_RANGE } from './game/strike';
import { GAME_PACE } from './game/pacing';
import { wrappedDistance, wrappedDeltaX } from './game/geometry';

type BuildingId = 'barracks' | 'tankPlant' | 'ordnance' | 'missileSite' | 'fields' | 'quarry' | 'mine' | 'oilPump';

const gameUnit = (typeId: string): Record<string, unknown> => activeSession?.unit(typeId) ?? { id: typeId, name: typeId, cost: {} };
const gameUnitLabel = (typeId: string): string => String(gameUnit(typeId).name ?? typeId);
const unitCostLabel = (typeId: string): string => Object.entries((gameUnit(typeId).buildCost ?? gameUnit(typeId).cost ?? {}) as Record<string, number>)
  .map(([k, v]) => `${v} ${k}`).join(' · ');
const buildingLabel = (id: BuildingId): string => String(activeSession?.building(id)?.label ?? id);
const buildingCostLabel = (id: BuildingId, tier = 1): string => {
  const definition = activeSession?.building(id);
  const tiers = definition?.tiers as Array<{ cost?: Record<string, number> }> | undefined;
  const cost = tiers?.[tier - 1]?.cost ?? definition?.cost ?? {};
  return Object.entries(cost as Record<string, number>)
  .map(([k, v]) => `${v} ${k}`).join(' · ');
};
type WorkOrderView = { progressWork?: number; totalWork?: number; progressHours?: number; totalHours?: number; workRate?: number };
const orderPercent = (o: WorkOrderView): number => {
  const progress = o.progressWork ?? o.progressHours ?? 0;
  const total = o.totalWork ?? o.totalHours ?? 0;
  return total > 0 ? Math.min(99, Math.floor((progress / total) * 100)) : 0;
};
const orderEtaSeconds = (o: WorkOrderView): number => Math.max(0,
  ((o.totalWork ?? o.totalHours ?? 0) - (o.progressWork ?? o.progressHours ?? 0))
    / Math.max(0.01, o.workRate ?? 1)
    / (GAME_PACE.clock.simulationHoursPerRealSecond * (activeSession?.devSimSpeed ?? 1)));
const technologyView = (session: RemoteGameSession) => {
  const levels = { infantry: 1, resources: 1, training: 1, hybrid: 1, armored: 1, ...(session.ownCountry.technologies ?? {}) };
  const research = session.ownCountry.research;
  return {
    levels,
    pending: session.pendingResearch(),
    ...(research ? { active: {
      branch: research.branch,
      targetLevel: research.targetLevel,
      progress: Math.min(1, research.progressHours / research.totalHours),
      etaSeconds: Math.max(0, research.totalHours - research.progressHours)
        / (GAME_PACE.clock.simulationHoursPerRealSecond * session.devSimSpeed),
    } } : {}),
  };
};

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
  // Wait for the server ack before announcing "started": an invalid target
  // (e.g. a non-urban province) is refused server-side and surfaces its own
  // "Order rejected" notification, so an eager optimistic toast here would
  // contradict it.
  const result = session.build(provinceId, buildingId as BuildingId, () => {
    pushNotification('information', `${buildingLabel(buildingId as BuildingId)} started`,
      'Construction is under way.');
    if (selectedProvinceId === provinceId) refreshSelectedProvince(session);
  });
  if (!result.ok) {
    pushNotification('warning', 'Construction', result.reason ?? 'Cannot build that here.');
    return;
  }
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
const diagnostics = required<HTMLElement>('diagnostics');
const diagnosticsStats = required<HTMLElement>('diagnostics-stats');
const diagnosticsPerformance = required<HTMLElement>('diagnostics-performance');
const debugDateTime = required<HTMLInputElement>('debug-datetime');
const debugTimeState = required<HTMLOutputElement>('debug-time-state');
const debugTimeApply = required<HTMLButtonElement>('debug-time-apply');
const debugTimeLink = required<HTMLButtonElement>('debug-time-link');
const debugTimePresets = [...document.querySelectorAll<HTMLButtonElement>('[data-debug-time]')];
const debugWeatherMode = required<HTMLSelectElement>('debug-weather-mode');
const debugWeatherState = required<HTMLOutputElement>('debug-weather-state');
const debugThunder = required<HTMLButtonElement>('debug-thunder');
const debugSimSpeedState = required<HTMLOutputElement>('debug-sim-speed-state');
const debugSimSpeedInput = required<HTMLInputElement>('debug-sim-speed');
const debugSimSpeedNumber = required<HTMLInputElement>('debug-sim-speed-number');
const debugSimSpeedButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-sim-speed]')];
const debugServerHealth = required<HTMLElement>('debug-server-health');
const debugServerWarning = required<HTMLElement>('debug-server-warning');
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
const debugCheatBuilding = required<HTMLFormElement>('debug-cheat-building');
const debugCheatBuildingProvince = required<HTMLInputElement>('debug-cheat-building-province');
const debugCheatBuildingChoice = required<HTMLSelectElement>('debug-cheat-building-choice');
const debugCheatUnit = required<HTMLFormElement>('debug-cheat-unit');
const debugCheatUnitProvince = required<HTMLInputElement>('debug-cheat-unit-province');
const debugCheatUnitCountry = required<HTMLInputElement>('debug-cheat-unit-country');
const debugCheatUnitChoice = required<HTMLSelectElement>('debug-cheat-unit-choice');
const debugCheatResource = required<HTMLFormElement>('debug-cheat-resource');
const debugCheatResourceCountry = required<HTMLInputElement>('debug-cheat-resource-country');
const debugCheatResourceKind = required<HTMLSelectElement>('debug-cheat-resource-kind');
const debugCheatResourceAmount = required<HTMLInputElement>('debug-cheat-resource-amount');
const debugCheatStatus = required<HTMLElement>('debug-cheat-status');

/** Last server weather state applied locally, so the 400ms HUD poll only
 *  touches the renderer/audio when a broadcast actually changed something —
 *  including when this client itself is the one that just sent it. */
let lastAppliedWeather: { raining: boolean; mode: string } | null = null;
/** Mirrors units/movement.ts's NAVAL_STATUSES — a stack mid sea-crossing
 *  can't be moved, attacked with, split, or stopped from the HUD. */
const NAVAL_TRANSIT_STATUSES = new Set(['embarking', 'atSea', 'disembarking']);
const mapModes = required<HTMLFieldSetElement>('map-modes');
const mapModeInputs = [...document.querySelectorAll<HTMLInputElement>('input[name="map-mode"]')];
const unsupported = required<HTMLElement>('unsupported');
const compactNumber = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

// Starts locked. The game-server deployment gate grants access after handshake.
let debugEnabled = false;

// The single typed channel between renderer/game systems and the player HUD.
const uiStore = createUiStore(createInitialState({ quality: loadQuality() }));

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
const readDiplomacyMessages = new Set<string>();
const announcedDiplomacyItems = new Set<string>();
const diplomacyProposalStatuses = new Map<string, string>();
let diplomacyBootstrapped = false;
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
let targetingMode: 'move' | 'attack' | 'retreat' | 'split' | 'strike' | null = null;
let pendingSplitGroups: Array<{ typeId: string; count: number }> | null = null;
// Selected province: id + the renderer-supplied labels, kept so the card can be
// re-projected from GameState (e.g. after a capture) without a reselect.
let selectedProvinceId: number | null = null;
let selectedProvinceName = '';
let selectedProvinceTerrain = '';
/** True while the next map click places the selected province's rally point. */
let awaitingRallyTarget = false;
// Shift-click waypoint queue (client-side only — the server has no notion of
// a multi-leg order). Each army's queued destinations wait until the army
// reports 'idle' (its current order finished) before the next one is issued.
// `armyWaypointIssuing` guards against re-firing the same waypoint on every
// subsequent 'change' event while the just-sent order is still in flight and
// the army's locally-known status has not yet flipped away from 'idle'.
const armyWaypointQueues = new Map<string, Array<{ x: number; z: number }>>();
const armyWaypointIssuing = new Set<string>();
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
// The menu is fully styled and wired by this point (mountMenu ran after the
// session/lobby fetches resolved) — swap the boot spinner for it in one go so
// there is never a frame of raw, unstyled HTML.
required<HTMLElement>('menu-root').hidden = false;
required<HTMLElement>('boot-loading').hidden = true;

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
  lastAppliedWeather = null;
  debugEnabled = false;
  diagnostics.hidden = true;
  uiStore.patch({ debugEnabled: false });
  setDebugHandles(window as unknown as Record<string, unknown>, false, {});
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
  await verifyWorldDescriptor(connection.world);
  configureWorldAssetBase(connection.world.assetBaseUrl, connection.world.artifactHashes);
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

  const syncDebugAccess = (): void => {
    debugEnabled = session.debugEnabled;
    if (!debugEnabled) diagnostics.hidden = true;
    uiStore.patch({ debugEnabled });
    setDebugHandles(window as unknown as Record<string, unknown>, debugEnabled, {
      renderer, combatEffects, session,
    });
  };
  syncDebugAccess();

  // Every DOM/debug listener below belongs to this renderer attempt. Retry or
  // Return to Command aborts them in one shot so failed launches cannot retain
  // an old renderer or stack duplicate handlers onto the next attempt.
  const attemptEvents = new AbortController();
  const attemptListener = { signal: attemptEvents.signal } as const;
  launchDisposers.push(() => attemptEvents.abort());
  connection.addEventListener('debug-access', syncDebugAccess, attemptListener);

  // The connection reconnects on its own (1s, then every 2.5s) but did so
  // silently — an unstable link just looked like a frozen game. Surface it, and
  // confirm when the stream recovers.
  let connectionDropped = false;
  connection.addEventListener('connection-status', () => {
    const disconnected = connection.status === 'disconnected'
      || connection.status === 'closed' || connection.status === 'incompatible';
    if (disconnected && !connectionDropped) {
      connectionDropped = true;
      pushNotification('warning', 'Connection lost', 'Reconnecting to the command server…');
    } else if (connection.status === 'ready' && connectionDropped) {
      connectionDropped = false;
      pushNotification('information', 'Reconnected', 'Live command stream restored.');
    }
  }, attemptListener);

  // Persist browser failures and enough input-routing context to distinguish a
  // blocked canvas from a stalled renderer or an unhealthy command stream.
  window.addEventListener('error', (event) => connection.reportDiagnostic('error', 'browser_uncaught_error', {
    message: event.message || 'Unknown browser error',
    filename: event.filename || null, line: event.lineno, column: event.colno,
  }), attemptListener);
  window.addEventListener('unhandledrejection', (event) => connection.reportDiagnostic(
    'error', 'browser_unhandled_rejection', {
      message: event.reason instanceof Error ? event.reason.message : String(event.reason),
      stack: event.reason instanceof Error ? event.reason.stack?.slice(0, 1_000) ?? null : null,
    },
  ), attemptListener);
  window.addEventListener('online', () => connection.reportDiagnostic('info', 'browser_online'), attemptListener);
  window.addEventListener('offline', () => connection.reportDiagnostic('warn', 'browser_offline'), attemptListener);
  document.addEventListener('visibilitychange', () => connection.reportDiagnostic('info', 'visibility_changed', {
    visibility: document.visibilityState,
  }), attemptListener);
  window.addEventListener('pointerdown', (event) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    connection.reportDiagnostic('debug', 'pointer_input', {
      x: event.clientX, y: event.clientY, pointerType: event.pointerType,
      targetTag: target?.tagName ?? null, targetId: target?.id || null,
      targetClass: target?.className ? String(target.className).slice(0, 300) : null,
      targetPointerEvents: target ? getComputedStyle(target).pointerEvents : null,
      canvasTarget: event.target === canvas,
    });
  }, { ...attemptListener, capture: true });
  let lastWheelDiagnostic = 0;
  window.addEventListener('wheel', (event) => {
    const now = performance.now();
    if (now - lastWheelDiagnostic < 1_000) return;
    lastWheelDiagnostic = now;
    const target = event.target instanceof HTMLElement ? event.target : null;
    connection.reportDiagnostic('debug', 'wheel_input', {
      x: event.clientX, y: event.clientY, deltaX: event.deltaX, deltaY: event.deltaY,
      targetTag: target?.tagName ?? null, targetId: target?.id || null,
      canvasTarget: event.target === canvas,
    });
  }, { ...attemptListener, capture: true, passive: true });

  const disposeRendererOnPagehide = (event: PageTransitionEvent): void => {
    if (!event.persisted) renderer.dispose();
  };
  window.addEventListener('pagehide', disposeRendererOnPagehide);
  launchDisposers.push(() => window.removeEventListener('pagehide', disposeRendererOnPagehide));
  // Hover deposits come from the fog-aware GameSession projection once it
  // exists; before that (and for water) show no deposit chips. The renderer's
  // own natural-resource table bypasses fog and must not drive player hover.
  renderer.onHover = (info, x, y) => {
    const economy = info && activeSession
      ? activeSession.state.provinceEconomies?.[info.id] as { resourcePotential?: Record<string, number> } | undefined
      : undefined;
    updateTooltip(info, x, y, economy?.resourcePotential ?? null);
  };

  // Attack-order cursor feedback. With an own army selected, the world cursor
  // becomes the 0 A.D. attack cursor over any detected enemy stack, and
  // the "no" cursor while aiming an attack at anything that can't be struck.
  // contact-only stacks remain composition-redacted even though their known
  // map position can now receive an attack order.
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
    // Panning/orbiting fires a pointermove per pixel of drag; the player is
    // repositioning the view, not aiming an order, so skip the raycast +
    // army-picker spatial query entirely rather than repeat it uselessly for
    // every one of those moves. The cursor just holds its last state until
    // the drag ends and a real hover position resumes driving it.
    if (renderer.camera.isDragging) return;
    const hoveredId = renderer.pickArmyAt(clientX, clientY);
    const hovered = hoveredId && hoveredId !== selectedArmyId ? session.army(hoveredId) : null;
    const strikable = Boolean(hovered && !hovered.own);
    // In attack mode a click also lands on enemy/neutral *territory* (an
    // orderAttackProvince fallback), so the cursor must accept a province the
    // same way the click does — otherwise it reads "not allowed" over ground
    // the order will happily take.
    const groundStrikable = targetingMode === 'attack' && !strikable && (() => {
      const ground = renderer.groundPointAt(clientX, clientY);
      if (!ground) return false;
      const provinceId = renderer.provinceIdAt(clientX, clientY);
      return provinceId >= 0 && !session.ownsProvince(provinceId);
    })();
    if (strikable || groundStrikable) {
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
    navSelect: (id) => {
      if (id !== 'diplomacy' && id !== 'research') return;
      const open = uiStore.get().activeSidePanel === id;
      uiStore.patch({ activeSidePanel: open ? null : id });
      if (id === 'diplomacy' && !open) {
        const selected = uiStore.get().diplomacy.selectedCountryId
          ?? Object.values(session.state.countries)
            .filter((country) => country.id !== session.playerCountryId)
            .sort((a, b) => a.name.localeCompare(b.name))[0]?.id
          ?? null;
        if (selected !== null) markDiplomacyRead(session, selected);
        syncDiplomacyView(session, selected ?? undefined);
      }
    },
    selectDiplomacyCountry: (countryId) => {
      for (const message of session.state.diplomacy?.messages ?? []) {
        if (message.fromCountryId === countryId || message.toCountryId === countryId) {
          readDiplomacyMessages.add(message.id);
        }
      }
      uiStore.patch({ activeSidePanel: 'diplomacy' });
      syncDiplomacyView(session, countryId);
    },
    sendDiplomaticMessage: (countryId, body) => {
      diplomacyCommand(session, 'message', (done) => session.sendDiplomaticMessage(countryId, body, done));
    },
    proposeAlliance: (countryId) => {
      void showGameConfirmation('Propose alliance?', 'Send an alliance proposal to this country?')
        .then((yes) => { if (yes) diplomacyCommand(session, 'alliance', (done) => session.proposeDiplomacy(countryId, 'alliance', done)); });
    },
    offerPeace: (countryId) => {
      void showGameConfirmation('Offer peace?', 'Send a peace proposal to end this war?')
        .then((yes) => { if (yes) diplomacyCommand(session, 'peace', (done) => session.proposeDiplomacy(countryId, 'peace', done)); });
    },
    declareWar: (countryId) => {
      const name = session.state.countries[countryId]?.name ?? 'this country';
      void showGameConfirmation('Declare war?', `Open hostilities with ${name}?`)
        .then((yes) => { if (yes) diplomacyCommand(session, 'declare-war', (done) => session.declareWar(countryId, done)); });
    },
    endAlliance: (countryId) => {
      void showGameConfirmation('End alliance?', 'End the current alliance with this country?')
        .then((yes) => { if (yes) diplomacyCommand(session, 'end-alliance', (done) => session.endAlliance(countryId, done)); });
    },
    respondDiplomacy: (proposalId, accept) => {
      diplomacyCommand(session, 'proposal-response', (done) => session.respondDiplomacy(proposalId, accept, done));
    },
    researchTechnology: (branch) => {
      session.research(branch as TechnologyBranch, () => {
        pushNotification('information', 'Research started', `${branch[0].toUpperCase()}${branch.slice(1)} development is under way.`);
      });
    },
    dismissNotification: (id) => removeNotification(id),
    togglePause: (open) => uiStore.patch({ paused: open }),
    returnToMenu: () => {
      void (async () => {
        const confirmed = await showGameConfirmation(
          'Return to main menu?',
          'The operation autosaves continuously in the background, so nothing is lost. End this session and return to the menu?',
        );
        if (!confirmed) return;
        uiStore.patch({ paused: false });
        launchToken += 1;
        await teardownPartialLaunch();
        hideLoader();
        canvas.hidden = true;
        uiStore.patch({ phase: 'lobby' });
        rendererStarted = false;
      })();
    },
    armStrike: () => armStrike(session),
    focusWorld: (x, z) => renderer.focus(x, z, 900),
    zoomMap: (factor) => renderer.zoomMap(factor),
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
      undefined,
      (x, z) => renderer.isWorldPointVisible(x, z, 160),
    );
    renderer.setCombatEffects(packed.floats, packed.count);
    if (!diagnostics.hidden) updateDiagnostics(stats);
  };
  renderer.onDiplomacyChange = (state) => {
    uiStore.patch({ playerCountry: { name: state.player.name, color: state.player.color } });
    if (state.enemies.length > 0 && music.getState() !== 'victory') {
      void music.setState('war');
    } else if (state.enemies.length === 0 && music.getState() === 'war') {
      void music.setState('peace');
    }
    // Spell out the win condition the first time each war opens: taking that
    // country's capital is what ends it.
    for (const enemy of state.enemies) {
      if (announcedWarAims.has(enemy.id)) continue;
      announcedWarAims.add(enemy.id);
      pushNotification('information', 'War aims',
        `Capture ${enemy.name}'s capital to knock them out of the war.`);
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
    const isNewProvinceSelection = info.id !== selectedProvinceId;
    if (session) {
      if (isNewProvinceSelection) awaitingRallyTarget = false;
      if (isNewProvinceSelection) void audio.playUiCue('select');
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

  debugTimeLink.addEventListener('click', () => {
    session.linkDevClockToTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  }, attemptListener);

  const setVisualHour = (hour: number): void => {
    const reading = session.readClock();
    const offsetMs = reading.utcOffsetMinutes * 60_000;
    const shifted = new Date(session.readEpochMs() + offsetMs);
    const wholeHour = Math.floor(hour);
    shifted.setUTCHours(wholeHour, Math.round((hour - wholeHour) * 60), 0, 0);
    session.setDevClock(shifted.getTime() - offsetMs);
  };

  debugTimeApply.addEventListener('click', () => {
    const reading = session.readClock();
    const localEpoch = Date.parse(`${debugDateTime.value}Z`);
    if (Number.isFinite(localEpoch)) session.setDevClock(localEpoch - reading.utcOffsetMinutes * 60_000);
  }, attemptListener);
  for (const preset of debugTimePresets) {
    preset.addEventListener('click', () => {
      const hour = Number(preset.dataset.debugTime);
      setVisualHour(hour);
    }, attemptListener);
  }
  debugWeatherMode.addEventListener('change', () => {
    session.setDevWeather(debugWeatherMode.value as 'automatic' | 'forced-clear' | 'forced-rain');
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

  const buildingIds: BuildingId[] = ['barracks', 'tankPlant', 'ordnance', 'missileSite', 'fields', 'quarry', 'mine', 'oilPump'];
  debugCheatBuildingChoice.replaceChildren(...buildingIds.flatMap((buildingId) =>
    Array.from({ length: 5 }, (_, index) => {
      const option = document.createElement('option');
      option.value = `${buildingId}:${index + 1}`;
      option.textContent = `${buildingLabel(buildingId)} — Level ${index + 1}`;
      return option;
    })));
  debugCheatUnitChoice.replaceChildren(...['infantry', 'engineer', 'armored-car', 'light-tank', 'artillery', 'medium-tank'].map((unitId) => {
    const option = document.createElement('option');
    option.value = unitId; option.textContent = gameUnitLabel(unitId); return option;
  }));
  debugCheatBuilding.addEventListener('submit', (event) => {
    event.preventDefault();
    const [buildingId, rawLevel] = debugCheatBuildingChoice.value.split(':');
    session.devCheatBuild(Number(debugCheatBuildingProvince.value), buildingId as BuildingId, Number(rawLevel));
    debugCheatStatus.textContent = 'Applying building cheat…';
  }, attemptListener);
  debugCheatUnit.addEventListener('submit', (event) => {
    event.preventDefault();
    session.devCheatSpawnUnit(Number(debugCheatUnitProvince.value), Number(debugCheatUnitCountry.value), debugCheatUnitChoice.value);
    debugCheatStatus.textContent = 'Spawning unit…';
  }, attemptListener);
  debugCheatResource.addEventListener('submit', (event) => {
    event.preventDefault();
    session.devCheatGiveResource(
      Number(debugCheatResourceCountry.value),
      debugCheatResourceKind.value as 'funds' | 'manpower' | 'food' | 'stone' | 'metal' | 'oil',
      Number(debugCheatResourceAmount.value),
    );
    debugCheatStatus.textContent = 'Granting resource…';
  }, attemptListener);
  session.addEventListener('dev-cheat-result', (event) => {
    const result = (event as CustomEvent<{ ok: boolean; message: string }>).detail;
    debugCheatStatus.textContent = result.message;
    debugCheatStatus.classList.toggle('is-error', !result.ok);
  }, attemptListener);

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
    if (!debugEnabled) return;
    diagnostics.hidden = !diagnostics.hidden;
  };
  let debugChordArmed = false;
  window.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.code === 'KeyD') {
      event.preventDefault();
      debugChordArmed = true;
      return;
    }
    if (debugChordArmed && event.code === 'KeyE') {
      event.preventDefault();
      debugChordArmed = false;
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
  window.addEventListener('keyup', (event) => {
    if (event.code === 'Escape') debugChordArmed = false;
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
    } catch (error) {
      debugConnections.checked = false;
      await renderer.setConnectionsVisible(false);
      pushNotification('warning', 'Debug overlay', `Movement graph failed to load: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      debugConnections.disabled = false;
    }
  }, attemptListener);
  debugRivers.addEventListener('change', async () => {
    debugRivers.disabled = true;
    try {
      await renderer.setWaterwayNetworkVisible(debugRivers.checked);
    } catch (error) {
      debugRivers.checked = false;
      await renderer.setWaterwayNetworkVisible(false);
      pushNotification('warning', 'Debug overlay', `Waterway graph failed to load: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      debugRivers.disabled = false;
    }
  }, attemptListener);
  // Any failure from here on propagates to runLaunch(), which tears the partial
  // attempt down and shows the loader's Retry / Return-to-Command error state.
  await withTimeout(
    renderer.initialize((stage, progress) => setLoadingStage(stage, 0.12 + progress * 0.8)),
    300_000,
    'Preparing the renderer',
  );
  if (token !== launchToken) return;
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
}

const simSpeedGroup = debugSimSpeedButtons[0]?.closest<HTMLElement>('.sim-speed-controls');
const clampDebugSpeed = (value: number): number => Math.max(1, Math.min(10_000, Math.round(value * 10) / 10));
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
  debugSimSpeedState.textContent = `${session.devSimSpeed.toLocaleString(undefined, { maximumFractionDigits: 1 })}×`;
  if (document.activeElement !== debugSimSpeedInput) debugSimSpeedInput.value = String(Math.log10(session.devSimSpeed));
  if (document.activeElement !== debugSimSpeedNumber) debugSimSpeedNumber.value = session.devSimSpeed.toFixed(1);
  for (const button of debugSimSpeedButtons) {
    button.setAttribute('aria-pressed', String(Number(button.dataset.simSpeed) === session.devSimSpeed));
  }
}
debugSimSpeedInput.addEventListener('input', () => {
  const multiplier = clampDebugSpeed(10 ** Number(debugSimSpeedInput.value));
  debugSimSpeedNumber.value = multiplier.toFixed(1);
  debugSimSpeedState.textContent = `${multiplier.toLocaleString(undefined, { maximumFractionDigits: 1 })}×`;
});
debugSimSpeedInput.addEventListener('change', () => {
  const multiplier = clampDebugSpeed(10 ** Number(debugSimSpeedInput.value));
  activeSession?.setDevSimSpeed(multiplier);
});
debugSimSpeedNumber.addEventListener('change', () => {
  const multiplier = clampDebugSpeed(Number(debugSimSpeedNumber.value) || 1);
  debugSimSpeedNumber.value = multiplier.toFixed(1);
  debugSimSpeedInput.value = String(Math.log10(multiplier));
  activeSession?.setDevSimSpeed(multiplier);
});
for (const button of debugSimSpeedButtons) {
  // Module-level, one-time wiring (unlike the per-launch listeners above,
  // these static buttons and activeSession outlive any single game attempt).
  button.addEventListener('click', () => {
    activeSession?.setDevSimSpeed(Number(button.dataset.simSpeed));
  });
}

/**
 * Apply the server-broadcast debug time-of-day/rain override to this client's
 * renderer + audio, same as every other connected player sees — mirrors
 * syncSimSpeedUi's shared-server-state model. Runs every HUD tick but only
 * touches the renderer when the broadcast value actually changed, so it is a
 * no-op for a server with no active override (the common case).
 */
function syncWeatherUi(session: RemoteGameSession, renderer: WorldRenderer): void {
  const weather = session.state.weather;
  const next = { raining: weather?.raining ?? false, mode: weather?.mode ?? 'automatic' };
  if (lastAppliedWeather
    && lastAppliedWeather.raining === next.raining && lastAppliedWeather.mode === next.mode) return;
  lastAppliedWeather = next;
  renderer.setRainEnabled(next.raining);
  void audio.setRainEnabled(next.raining);
  debugWeatherMode.value = next.mode;
  debugWeatherState.textContent = next.raining ? 'Raining now' : 'Clear now';
  uiStore.patch({ weather: { raining: next.raining, label: next.raining ? 'Rain' : 'Clear' } });
}

function syncServerDiagnostics(session: RemoteGameSession): void {
  const d = session.devDiagnostics;
  debugServerHealth.textContent = [
    `requested  ${d.requestedSpeed.toFixed(1)}×`,
    `effective  ${d.effectiveSpeed.toFixed(1)}×`,
    `debt       ${d.pendingSimulationSeconds.toFixed(2)} sim seconds`,
    `last pump  ${d.lastPumpSteps} steps / ${d.lastPumpMilliseconds.toFixed(2)} ms`,
  ].join('\n');
  debugServerWarning.hidden = !d.overloaded;
  debugServerWarning.textContent = d.overloaded ? 'Server is accumulating simulation debt and cannot currently maintain the requested speed.' : '';
}

async function bootstrapGameSession(
  renderer: WorldRenderer, session: RemoteGameSession,
): Promise<void> {
  readDiplomacyMessages.clear();
  announcedDiplomacyItems.clear();
  diplomacyProposalStatuses.clear();
  diplomacyBootstrapped = false;
  selectedArmyId = null;
  awaitingMoveTarget = false;
  targetingMode = null;
  pendingSplitGroups = null;
  if (debugEnabled) {
    // Authoritative-state inspection handle for QA / perf scripts. Exposing the
    // full GameState defeats fog of war, so it is installed only after the
    // authenticated server handshake grants debug access.
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
  renderer.setProvinceResourcePotentials(session.state.provinceEconomies);
  renderer.setPlayerCountryByName(player.name);
  renderer.setDiplomaticRelations(session.state.relations);
  const { x, z, distance } = session.state.startCamera;
  // Deterministic near-top-down view centred on the player's homeland; no prior
  // orbit orientation carries over. The player can orbit away afterwards.
  renderer.focusPlayerStart(x, z, distance);

  // Left-tap -> army selection / armed-order placement (does not also select a
  // province if it was consumed). Right-click -> direct move/attack order for
  // the selected army, the primary fast interaction.
  renderer.onMapClick = (clientX, clientY, shiftKey) => handleMapClick(renderer, session, clientX, clientY, shiftKey);
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
  let presentationGeneration = session.baselineGeneration;
  const syncDiplomaticRelations = (): void => {
    renderer.setDiplomaticRelations(session.state.relations);
    renderer.setProvinceOwners(Object.entries(session.state.provinceOwners).map(([provinceId, countryId]) => ({ provinceId: Number(provinceId), countryId })));
    renderer.setProvinceResourcePotentials(session.state.provinceEconomies);
    if (presentationGeneration !== session.baselineGeneration) {
      armyMotionInterpolator.clear(); combatEffects.clear(); presentationGeneration = session.baselineGeneration;
    }
    syncArmyMarkers(session, renderer);
    advanceWaypointQueues(session);
  };
  session.addEventListener('change', syncDiplomaticRelations);
  const onDiplomacySessionChange = (): void => syncDiplomacyView(session);
  session.addEventListener('change', onDiplomacySessionChange);
  launchDisposers.push(() => session.removeEventListener('change', onDiplomacySessionChange));
  syncDiplomacyView(session);

  uiStore.patch({
    playerCountry: { name: player.name, color: player.color },
    resources: playerResourceLines(session),
    resourceOverlay: false,
    countryPhase: session.ownCountry.phase,
    technology: technologyView(session),
  });

  // Initial marker upload (before the first sim tick) so armies show at once.
  syncArmyMarkers(session, renderer);

  // Persistent visual world time is interpolated locally at real 1x. It only
  // drives sunlight and the analogue HUD; gameplay uses simulation elapsed time.
  renderer.setTimeMultiplier(0);
  const updateCivilClock = (): void => {
    const clock = session.readClock();
    uiStore.patch({ clock });
    renderer.setTimeOfDay(clock.hour + clock.minute / 60 + clock.second / 3_600);
    debugTimeLink.setAttribute('aria-pressed', String(clock.timezoneLinked));
    debugTimeLink.textContent = clock.timezoneLinked
      ? `Timezone linked: ${clock.timeZone ?? 'browser'}` : 'Use browser timezone';
    if (document.activeElement !== debugDateTime) {
      debugDateTime.value = new Date(session.readEpochMs() + clock.utcOffsetMinutes * 60_000).toISOString().slice(0, 19);
    }
  };
  updateCivilClock();
  const civilClockTimer = window.setInterval(updateCivilClock, 250);

  // Replica/HUD refresh, decoupled from the authoritative simulation.
  let knownTechnologyLevels = { ...technologyView(session).levels };
  const hudTimer = window.setInterval(() => {
    // Fog visibility is O(foreignArmies × visionSources); compute it once per
    // HUD tick and share it between the marker upload and the selection card.
    const nextTechnology = technologyView(session);
    for (const branch of ['infantry', 'resources', 'training', 'hybrid', 'armored'] as TechnologyBranch[]) {
      if (nextTechnology.levels[branch] > knownTechnologyLevels[branch]) {
        pushNotification('completed', 'Technology developed', `${branch[0].toUpperCase()}${branch.slice(1)} Level ${nextTechnology.levels[branch]} is now available.`);
      }
    }
    knownTechnologyLevels = { ...nextTechnology.levels };
    uiStore.patch({ resources: playerResourceLines(session), countryPhase: session.ownCountry.phase, technology: nextTechnology });
    syncArmyMarkers(session, renderer);
    syncCombatMarkers(session);
    spawnOngoingBattleFx(session, renderer);
    refreshSelectedArmy(session);
    refreshSelectedProvince(session); // keep production / construction % live
    drainSessionEvents(session);
    syncSimSpeedUi();
    syncWeatherUi(session, renderer);
    syncServerDiagnostics(session);
  }, 400);
  const typingInField = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.repeat || typingInField(event.target)) return;
    // Strategic strike is a nation-level order, not an army order, so it has a
    // keyboard arm (N) — the only keyed order in the game. It needs no
    // selection; the next map click picks the target province.
    if (event.code === 'KeyN' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      armStrike(session);
      return;
    }
    if (event.key === 'Escape' && targetingMode === 'strike') {
      targetingMode = null;
      pushNotification('information', 'Strike cancelled', 'The strategic strike was called off.');
      return;
    }
    if (!selectedArmyId) return;
    // Army commands are intentionally click-only so camera/navigation keys can
    // never issue an order. Escape remains the universal cancel/deselect key.
    if (event.key === 'Escape') deselectArmy();
  };
  window.addEventListener('keydown', onKey);
  const teardownSession = (): void => {
    window.clearInterval(hudTimer);
    window.clearInterval(civilClockTimer);
    armyMotionInterpolator.clear();
    armyWaypointQueues.clear();
    armyWaypointIssuing.clear();
    clearAllNotificationTimers();
    session.dispose();
    window.removeEventListener('keydown', onKey);
    session.removeEventListener('change', syncDiplomaticRelations);
    combatEffects.clear();
    if (activeSession === session) activeSession = undefined;
    setDebugHandles(window as unknown as Record<string, unknown>, false, {});
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

const armyMarkerScratch = new Float32Array(28 * 1_024);
const armyModelScratch = new Float32Array(16 * 4_096);
const armyMotionInterpolator = new ArmyMotionInterpolator();
/**
 * buildArmyFormation/buildArmyCompositionRows only depend on an army's troop
 * composition (unit types/counts/health), which changes far less often than
 * this function runs (every ~250-400ms marker sync, driven by position and
 * camera state that have nothing to do with composition) — rebuilding both
 * from scratch for every army on every sync was pure waste for a stack that
 * hasn't produced, lost, split or merged anything since the last sync.
 */
const armyPresentationCache = new Map<string, {
  key: string;
  formation: ReturnType<typeof buildArmyFormation>;
  compositionRows: ReturnType<typeof buildArmyCompositionRows>;
}>();
function armyCompositionKey(groups: readonly { typeId: string; count: number; health: number }[]): string {
  let key = '';
  for (const group of groups) key += `${group.typeId}:${group.count}:${group.health.toFixed(3)}|`;
  return key;
}
/** LineRecord (8 f32) per own-army route segment — see renderer.setOrderRoutes. */
const routeScratch = new Float32Array(8 * 4_096);

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
const armyPickScratch: ArmyPickEntry[] = [];
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
  // Must be the same epoch-ms clock as motion.sampledAtEpochMs (a server
  // Date.now() timestamp) — performance.now() here compared cleanly-out-of-
  // range against it, silently clamping every interpolation fraction to 0 and
  // turning "smooth interpolation" into "snap to each new sample" instead.
  const motionNow = Date.now();
  const activeArmyIds = new Set<string>();
  const activeModelKeys = new Set<string>();
  armyPickScratch.length = 0;

  // F2: past a far-zoom threshold, friendly stacks whose markers visually
  // overlap pile into an unreadable blob. Greedily merge any stack within one
  // marker-width (in world units at this zoom) of an already-kept
  // representative; the rest fold their strength into its badge. Individual
  // markers return on zoom-in, or when the selected army is in the group.
  const clusterSuppressed = new Set<string>();
  const clusterAggregate = new Map<string, number>();
  const clusterDistance = renderer.camera.distance;
  if (clusterDistance > 3_800) {
    // ~ one on-screen marker width, in world units (camera px->world ~ dist*0.00145).
    const mergeRadius = clusterDistance * 0.11;
    const mergeRadiusSq = mergeRadius * mergeRadius;
    const own = Object.values(session.state.armies)
      .filter((a) => a.own && a.contact === 'visible');
    // Bucket representatives into a grid sized to the merge radius so each new
    // stack only checks its own + neighbouring cells instead of every
    // representative found so far — was O(n^2) against every own army with a
    // large campaign (a full-map strategic zoom with hundreds of stacks made
    // this the dominant cost of every marker sync).
    const cellSize = Math.max(1, mergeRadius);
    const cellKey = (x: number, z: number): string => `${Math.floor(x / cellSize)}:${Math.floor(z / cellSize)}`;
    const grid = new Map<string, string[]>(); // cell key -> representative ids
    const groupsByRep = new Map<string, string[]>(); // representative id -> member ids
    for (const a of own) {
      const cx = Math.floor(a.x / cellSize);
      const cz = Math.floor(a.z / cellSize);
      let joinedRep: string | undefined;
      for (let dx = -1; dx <= 1 && !joinedRep; dx += 1) {
        for (let dz = -1; dz <= 1; dz += 1) {
          const reps = grid.get(`${cx + dx}:${cz + dz}`);
          if (!reps) continue;
          for (const repId of reps) {
            const rep = session.state.armies[repId];
            if (rep && (rep.x - a.x) ** 2 + (rep.z - a.z) ** 2 <= mergeRadiusSq) { joinedRep = repId; break; }
          }
          if (joinedRep) break;
        }
      }
      if (joinedRep) {
        groupsByRep.get(joinedRep)!.push(a.id);
      } else {
        groupsByRep.set(a.id, [a.id]);
        const key = cellKey(a.x, a.z);
        const bucket = grid.get(key);
        if (bucket) bucket.push(a.id); else grid.set(key, [a.id]);
      }
    }
    for (const ids of groupsByRep.values()) {
      if (ids.length < 2 || (selectedArmyId !== null && ids.includes(selectedArmyId))) continue;
      let repId = ids[0];
      let repCount = -1;
      let sum = 0;
      for (const id of ids) {
        const c = session.state.armies[id]?.composition?.unitCount ?? 0;
        sum += c;
        if (c > repCount) { repCount = c; repId = id; }
      }
      for (const id of ids) if (id !== repId) clusterSuppressed.add(id);
      clusterAggregate.set(repId, sum);
    }
  }

  // Combat huddle (visual only): every engaged army is grouped by the
  // authoritative battle-front id it reports (not a distance/grid heuristic,
  // so it can never miss a pair the sim itself considers engaged) and pulled
  // toward its cluster's centroid, so the army badges below and the
  // continuous fight FX (spawnOngoingBattleFx, spawned at that same centroid)
  // converge on the exact same spot instead of drifting apart. The player
  // projection never ships a front's own x/z, hence the centroid rather than
  // an authoritative anchor point. session.state.armies is never written
  // here — only the marker/model scratch buffers this function packs, and
  // only x/z (not the route target) are nudged.
  const battleAnchors = buildBattleAnchors(groupEngagedByFront(
    Object.values(session.state.armies)
      .filter((a) => a.status === 'engaged')
      .map((a) => ({
        id: a.id, x: a.x, z: a.z, ownerCountryId: a.ownerCountryId,
        frontIds: (a.battleFronts ?? []).map((f) => f.id),
      })),
  ));

  for (const army of Object.values(session.state.armies)) {
    if (count >= 1_024) break;
    const identified = army.contact === 'visible';
    activeArmyIds.add(army.id);
    if (clusterSuppressed.has(army.id)) continue; // folded into a cluster marker
    const armyMotionRaw = armyMotionInterpolator.sample(
      army.id,
      army.x,
      army.z,
      army.motion,
      motionNow,
      renderer.manifest?.world.width ?? 0,
    );
    const battleAnchor = army.status === 'engaged' ? battleAnchors.get(army.id) : undefined;
    const huddle = battleAnchor ? combatHuddleOffset({ x: army.x, z: army.z }, battleAnchor) : null;
    // Nudge the displayed x/z (and the in-flight motion target, so a stack
    // still easing toward a waypoint when combat starts doesn't un-huddle
    // mid-ease) toward the shared battle anchor. remainingMs is untouched.
    const armyMotion = huddle && (huddle.x !== 0 || huddle.z !== 0)
      ? {
          ...armyMotionRaw,
          x: armyMotionRaw.x + huddle.x,
          z: armyMotionRaw.z + huddle.z,
          targetX: armyMotionRaw.targetX + huddle.x,
          targetZ: armyMotionRaw.targetZ + huddle.z,
        }
      : armyMotionRaw;

    // Authoritative route polyline for the SELECTED own army only (move = cream,
    // attack = red, retreating = amber). Other armies' routes stay hidden so the
    // map isn't a web of lines; a deselect clears this on the next sync.
    if (army.own && army.id === selectedArmyId && army.moveRoute && army.moveRoute.length >= 2) {
      const colorFlag = army.moveIntent === 'attack' ? 1 : 0;
      const retreatFlag = army.status === 'retreating' ? 1 : 0;
      // `fraction` is 0 at the army and 1 at the destination; the route shader
      // uses it for a head-to-tail brightening and a slow flow pulse.
      const emitSegment = (
        ax: number, az: number, bx: number, bz: number, arrow: number, fraction = 1,
      ): void => {
        if (routeCount >= 4_096) return;
        routeScratch[routeCursor] = ax;
        routeScratch[routeCursor + 1] = az;
        routeScratch[routeCursor + 2] = bx;
        routeScratch[routeCursor + 3] = bz;
        routeScratch[routeCursor + 4] = colorFlag;
        routeScratch[routeCursor + 5] = fraction;
        routeScratch[routeCursor + 6] = retreatFlag;
        routeScratch[routeCursor + 7] = arrow;
        routeCursor += 8;
        routeCount += 1;
      };
      const route = army.moveRoute;
      const legs = Math.max(1, route.length - 1);
      const worldW = renderer.manifest?.world.width ?? 0;
      const wrapDelta = (d: number): number => {
        if (!worldW) return d;
        if (d > worldW / 2) return d - worldW;
        if (d < -worldW / 2) return d + worldW;
        return d;
      };
      // Direction-of-travel chevrons marched along the route at a fixed world
      // spacing, so a long path reads as "this way" without selecting the army
      // (F4: the line alone had only a single arrowhead at the destination).
      const CHEVRON_SPACING = 46;
      const CHEV_WING = 6;
      const CHEV_COS = Math.cos(2.5);
      const CHEV_SIN = Math.sin(2.5);
      let untilChevron = CHEVRON_SPACING * 0.5;
      for (let i = 0; i + 1 < route.length; i += 1) {
        emitSegment(route[i].x, route[i].z, route[i + 1].x, route[i + 1].z, 0, (i + 0.5) / legs);
        const lx = wrapDelta(route[i + 1].x - route[i].x);
        const lz = route[i + 1].z - route[i].z;
        const legLen = Math.hypot(lx, lz) || 1;
        const ex = lx / legLen;
        const ez = lz / legLen;
        for (let d = untilChevron; d < legLen; d += CHEVRON_SPACING) {
          const cx = route[i].x + ex * d;
          const cz = route[i].z + ez * d;
          const frac = (i + d / legLen) / legs;
          emitSegment(
            cx + CHEV_WING * (ex * CHEV_COS - ez * CHEV_SIN),
            cz + CHEV_WING * (ex * CHEV_SIN + ez * CHEV_COS), cx, cz, 1, frac,
          );
          emitSegment(
            cx + CHEV_WING * (ex * CHEV_COS + ez * CHEV_SIN),
            cz + CHEV_WING * (-ex * CHEV_SIN + ez * CHEV_COS), cx, cz, 1, frac,
          );
        }
        untilChevron = ((untilChevron - legLen) % CHEVRON_SPACING + CHEVRON_SPACING) % CHEVRON_SPACING;
      }
      // Chevron at the destination, oriented by the final leg tangent, in the
      // route's own colour. Kept small so it never buries the end point.
      const tip = route[route.length - 1];
      const prev = route[route.length - 2];
      const tx = wrapDelta(tip.x - prev.x);
      const tz = tip.z - prev.z;
      const tlen = Math.hypot(tx, tz) || 1;
      const ux = tx / tlen;
      const uz = tz / tlen;
      const WING = 9;
      const COS = Math.cos(2.5); // ~143deg: wings sweep back from the tip
      const SIN = Math.sin(2.5);
      emitSegment(tip.x + WING * (ux * COS - uz * SIN), tip.z + WING * (ux * SIN + uz * COS), tip.x, tip.z, 1);
      emitSegment(tip.x + WING * (ux * COS + uz * SIN), tip.z + WING * (-ux * SIN + uz * COS), tip.x, tip.z, 1);
    }

    let formation: ReturnType<typeof buildArmyFormation> = [];
    let compositionRows: ReturnType<typeof buildArmyCompositionRows> = [];
    if (identified) {
      const groups = army.composition?.groups ?? [];
      const key = armyCompositionKey(groups);
      const cached = armyPresentationCache.get(army.id);
      if (cached && cached.key === key) {
        formation = cached.formation;
        compositionRows = cached.compositionRows;
      } else {
        formation = buildArmyFormation(groups);
        compositionRows = buildArmyCompositionRows(groups);
        armyPresentationCache.set(army.id, { key, formation, compositionRows });
      }
      // A stack becomes one transport silhouette only for the underway phase.
      // During embark/disembark it remains visibly represented by its troops on
      // the coastal node; reaching land therefore restores the troop models
      // immediately, even while the short unloading dwell finishes.
      if (army.status === 'atSea' && formation.length) {
        formation = [{
          kind: 5,
          count: army.composition?.unitCount ?? 0,
          health: army.composition?.health ?? 0,
        }];
      }
    }
    armyMarkerScratch.fill(0, cursor, cursor + 28);
    armyMarkerScratch[cursor] = armyMotion.x;
    armyMarkerScratch[cursor + 1] = armyMotion.z;
    armyMarkerScratch[cursor + 2] = packRgb(army.ownerColor);
    armyMarkerScratch[cursor + 3] = identified ? 1 : 2;
    // Contact markers render as '?'; don't ship the real strength/health.
    const clusterSum = clusterAggregate.get(army.id);
    armyMarkerScratch[cursor + 4] = clusterSum ?? (identified ? army.composition?.unitCount ?? 0 : 0);
    armyMarkerScratch[cursor + 5] = identified ? army.composition?.health ?? 0 : 0;
    // Marker flags: bit 0 selected, bit 1 engaged / under fire, bit 2 cluster.
    armyMarkerScratch[cursor + 6] = (army.id === selectedArmyId ? 1 : 0)
      | (army.status === 'engaged' ? 2 : 0)
      | (clusterSum !== undefined ? 4 : 0);
    armyMarkerScratch[cursor + 7] = compositionRows.length;
    for (let row = 0; row < 6; row += 1) {
      const lane = row < 4 ? row : row - 4;
      const countBase = row < 4 ? cursor + 8 : cursor + 12;
      const kindBase = row < 4 ? cursor + 16 : cursor + 20;
      armyMarkerScratch[countBase + lane] = compositionRows[row]?.count ?? 0;
      armyMarkerScratch[kindBase + lane] = compositionRows[row]?.kind ?? 6;
    }
    armyMarkerScratch[cursor + 24] = armyMotion.targetX;
    armyMarkerScratch[cursor + 25] = armyMotion.targetZ;
    armyMarkerScratch[cursor + 26] = armyMotion.remainingMs / 1_000;
    armyMarkerScratch[cursor + 27] = 0;
    cursor += 28;
    count += 1;
    armyPickScratch.push({
      id: army.id, x: armyMotion.x, z: armyMotion.z,
      targetX: armyMotion.targetX, targetZ: armyMotion.targetZ,
      remainingMs: armyMotion.remainingMs,
    });

    if (identified && army.id === selectedArmyId && army.artillery && count < 1_024) {
      armyMarkerScratch.fill(0, cursor, cursor + 28);
      armyMarkerScratch[cursor] = armyMotion.x;
      armyMarkerScratch[cursor + 1] = armyMotion.z;
      armyMarkerScratch[cursor + 2] = packRgb(army.ownerColor);
      armyMarkerScratch[cursor + 3] = 3;
      armyMarkerScratch[cursor + 4] = army.artillery.range;
      armyMarkerScratch[cursor + 5] = 0;
      armyMarkerScratch[cursor + 6] = 0;
      armyMarkerScratch[cursor + 7] = 0;
      cursor += 28;
      count += 1;
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
      const desiredHeading = routeLookaheadHeading(route, target, armyMotion.x, armyMotion.z, worldW)
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
        const x = armyMotion.x + rightX * right + forwardX * forward;
        const z = armyMotion.z + rightZ * right + forwardZ * forward;
        const targetX = armyMotion.targetX + rightX * right + forwardX * forward;
        const targetZ = armyMotion.targetZ + rightZ * right + forwardZ * forward;
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
        // Model flags: bit 0 selected, bit 1 moving, bit 2 auto/manual retreat.
        // The skinned infantry shader uses these to choose a stationary pose,
        // Walking, Injured_Walk, or Injured_Walk_Backward.
        armyModelScratch[modelCursor + 6] = (army.id === selectedArmyId ? 1 : 0)
          | (marching ? 2 : 0)
          | (army.status === 'retreating' ? 4 : 0);
        armyModelScratch[modelCursor + 7] = heading;
        armyModelScratch[modelCursor + 8] = previousX;
        armyModelScratch[modelCursor + 9] = previous.z;
        armyModelScratch[modelCursor + 10] = 0;
        // Facing before this update — the shader eases from it to slot +7 over
        // the same window it uses to slide the model, so the turn is smooth
        // between the 2.5 Hz marker syncs.
        armyModelScratch[modelCursor + 11] = previousHeading ?? heading;
        armyModelScratch[modelCursor + 12] = targetX;
        armyModelScratch[modelCursor + 13] = targetZ;
        armyModelScratch[modelCursor + 14] = armyMotion.remainingMs / 1_000;
        armyModelScratch[modelCursor + 15] = 0;
        previousArmyModelPositions.set(modelKey, { x, z });
        modelCursor += 16;
        modelCount += 1;
      }
    }
  }
  for (const key of previousArmyModelPositions.keys()) {
    if (!activeModelKeys.has(key)) previousArmyModelPositions.delete(key);
  }
  armyMotionInterpolator.retain(activeArmyIds);
  for (const id of previousArmyHeading.keys()) {
    if (!activeArmyIds.has(id)) previousArmyHeading.delete(id);
  }
  for (const id of armyPresentationCache.keys()) {
    if (!activeArmyIds.has(id)) armyPresentationCache.delete(id);
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
      // Rally point itself is a constant-px screen-space marker (army-marker
      // layer, type 4) so it keeps size and contrast against terrain at full
      // strategic zoom (F15c). A short world-space chevron just short of it
      // keeps the incoming route direction.
      if (count < 1_024) {
        armyMarkerScratch.fill(0, cursor, cursor + 28);
        armyMarkerScratch[cursor] = tip.x;
        armyMarkerScratch[cursor + 1] = tip.z;
        armyMarkerScratch[cursor + 2] = packRgb('#e9d3aa');
        armyMarkerScratch[cursor + 3] = 4; // rally marker
        cursor += 28;
        count += 1;
      }
      const C = Math.cos(2.5);
      const S = Math.sin(2.5);
      const cbx = tip.x - rx * 26;
      const cbz = tip.z - rz * 26;
      const CW = 14;
      emitRally(cbx + CW * (rx * C - rz * S), cbz + CW * (rx * S + rz * C), cbx, cbz, 1);
      emitRally(cbx + CW * (rx * C + rz * S), cbz + CW * (-rx * S + rz * C), cbx, cbz, 1);
    }
  }
  // Missile Site range ring(s) — reuses the exact selected-artillery range-ring
  // mechanism (marker state 3, b.x = radius) while the player is aiming a
  // strategic strike, or has a friendly Missile Site province selected.
  const showMissileRange = targetingMode === 'strike'
    || (selectedProvinceId !== null && session.ownsProvince(selectedProvinceId)
      && (session.state.provinceBuildings[selectedProvinceId]?.missileSite ?? 0) > 0);
  if (showMissileRange) {
    const ownColor = packRgb(session.ownCountry.color);
    for (const [pidRaw, buildings] of Object.entries(session.state.provinceBuildings)) {
      if (count >= 1_024) break;
      if (!buildings.missileSite) continue;
      const pid = Number(pidRaw);
      if (session.state.provinceOwners[pid] !== session.playerCountryId) continue;
      const center = renderer.provinceCenter(pid);
      if (!center) continue;
      armyMarkerScratch.fill(0, cursor, cursor + 28);
      armyMarkerScratch[cursor] = center[0];
      armyMarkerScratch[cursor + 1] = center[1];
      armyMarkerScratch[cursor + 2] = ownColor;
      armyMarkerScratch[cursor + 3] = 3;
      armyMarkerScratch[cursor + 4] = MISSILE_RANGE;
      cursor += 28;
      count += 1;
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

/** Arm strategic-strike targeting: the next map click on an enemy province asks
 *  for confirmation, then spends a warhead. Nation-level, no army selection. */
function armStrike(session: RemoteGameSession): void {
  const ready = session.ownCountry.warheads ?? 0;
  if (ready < 1) {
    pushNotification('warning', 'No warhead ready',
      'Build a Missile Site to stockpile strategic warheads.');
    return;
  }
  targetingMode = 'strike';
  awaitingMoveTarget = false;
  pushNotification('warning', 'Strategic strike armed',
    `Click an enemy province within Missile Site range. ${ready} warhead${ready === 1 ? '' : 's'} ready · Esc to cancel.`);
}

/** A one-shot red reticle that snaps onto the click point and fades. Pure DOM,
 *  no renderer pipeline — the immediate "acknowledged" cue for an attack order. */
let attackFlashEl: HTMLDivElement | null = null;
/** Shift-click adds a waypoint instead of issuing the move immediately. */
function queueWaypoint(armyId: string, x: number, z: number): void {
  const queue = armyWaypointQueues.get(armyId) ?? [];
  queue.push({ x, z });
  armyWaypointQueues.set(armyId, queue);
}

/** Fire the next queued waypoint once an army's current order has finished. */
function advanceWaypointQueues(session: RemoteGameSession): void {
  for (const [armyId, queue] of armyWaypointQueues) {
    const army = session.army(armyId);
    if (!army || !army.own) { armyWaypointQueues.delete(armyId); armyWaypointIssuing.delete(armyId); continue; }
    if (army.status !== 'idle') { armyWaypointIssuing.delete(armyId); continue; }
    if (armyWaypointIssuing.has(armyId)) continue; // already issued; waiting for confirmation
    if (!queue.length) { armyWaypointQueues.delete(armyId); continue; }
    const next = queue.shift()!;
    if (!queue.length) armyWaypointQueues.delete(armyId);
    armyWaypointIssuing.add(armyId);
    const result = session.orderMove(armyId, next.x, next.z, 'move');
    if (!result.ok) armyWaypointIssuing.delete(armyId);
  }
}

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
  shiftKey = false,
): boolean {
  // 0. Armed strategic strike -> confirm, then spend a warhead on the province.
  if (targetingMode === 'strike') {
    const ground = renderer.groundPointAt(clientX, clientY);
    const provinceId = renderer.provinceIdAt(clientX, clientY);
    targetingMode = null;
    if (!ground || provinceId < 0) {
      pushNotification('warning', 'Strike aborted', 'Aim at land inside an enemy province.');
      return true;
    }
    if (session.ownsProvince(provinceId)) {
      pushNotification('warning', 'Strike aborted', 'That is your own territory.');
      return true;
    }
    const ownerId = session.state.provinceOwners[provinceId] ?? 0;
    const ownerName = session.state.countries[ownerId]?.name;
    void showGameConfirmation('Launch strategic strike?',
      ownerName
        ? `Devastate ${ownerName}'s province. This expends one warhead and forces open war.`
        : 'Devastate this province. This expends one warhead.',
    ).then((confirmed) => {
      if (!confirmed) return;
      const result = session.orderStrike(provinceId, ground[0], ground[1], () => {
        void audio.playUiCue('confirm');
        pushNotification('combat', 'Strike authorised', 'The warhead is away.');
      });
      if (!result.ok) {
        pushNotification('warning', 'Strike failed', result.reason ?? 'The strike could not be ordered.');
      }
    });
    return true;
  }
  // 1. Armed destination order -> issue to the clicked ground point. Holding
  //    Shift queues it as a waypoint after the army's current/last-queued
  //    order instead, and keeps the Move command armed for more waypoints —
  //    like 0ad's shift-click move queue. A plain click always still cancels
  //    aiming and issues (or replaces) the immediate order.
  if (targetingMode === 'move' && shiftKey && selectedArmyId && session.ownsArmy(selectedArmyId)) {
    const ground = renderer.groundPointAt(clientX, clientY);
    if (ground) {
      queueWaypoint(selectedArmyId, ground[0], ground[1]);
      advanceWaypointQueues(session);
      void audio.playUiCue('move');
      pushNotification('information', 'Waypoint queued',
        'Shift-click to add more, or click without Shift to stop aiming.');
      syncArmyMarkers(session, renderer);
      refreshSelectedArmy(session);
      return true;
    }
  }
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
      } else {
        void audio.playUiCue('move');
        // A fresh, unqueued order supersedes anything still waiting.
        armyWaypointQueues.delete(selectedArmyId);
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
    // Fired once the server accepts the order — which is *after* any "Declare
    // war?" confirmation but still before combat opens. Do not run it
    // before acceptance: a cancelled war declaration must not leave the player
    // told their attack was "issued". Reticle on the target, an order cue and
    // a toast; pending intent already reports that the command is awaiting confirmation.
    const acknowledgeAttack = (): void => {
      flashAttackTarget(clientX, clientY);
      void audio.playUiCue('confirm');
      pushNotification('information', 'Attack order issued',
        'Your force is advancing to engage.');
    };
    const result = targetArmyId && targetArmyId !== selectedArmyId && pickedTarget && !pickedTarget.own
      ? session.orderAttackArmy(selectedArmyId, targetArmyId, acknowledgeAttack)
      : (() => {
        const ground = renderer.groundPointAt(clientX, clientY);
        const provinceId = renderer.provinceIdAt(clientX, clientY);
        if (!ground || provinceId < 0) {
          return { ok: false as const, reason: 'Aim at an enemy army or a province centre to attack.' };
        }
        if (session.ownsProvince(provinceId)) {
          return { ok: false as const, reason: "That is your own territory — you can't attack it." };
        }
        return session.orderAttackProvince(
          selectedArmyId!, provinceId, ground[0], ground[1], acknowledgeAttack,
        );
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
    if (ground) {
      const result = session.orderRetreat(selectedArmyId, ground[0], ground[1]);
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
      void audio.playUiCue('move');
      awaitingRallyTarget = false;
      pushNotification('information', 'Rally point set', 'New units from here will march to it.');
      refreshSelectedProvince(session);
      return true;
    }
  }
  // 2. Army pick. Clicking a different army selects it. Clicking the army that
  //    is already selected drops it and falls through to the province beneath —
  //    so a city with a garrison sitting on it is still selectable to queue
  //    production or start a building. Unless another stack is co-located
  //    (e.g. the two sides of a battle occupying the same node), in which
  //    case the repeat click cycles to that other stack instead of dropping
  //    the selection — otherwise the opposing force is never reachable.
  const hit = renderer.pickArmyAt(clientX, clientY);
  if (hit && hit !== selectedArmyId) {
    selectArmy(session, hit);
    return true;
  }
  if (hit && hit === selectedArmyId) {
    const other = renderer.pickArmiesAt(clientX, clientY).find((id) => id !== hit);
    if (other) { selectArmy(session, other); return true; }
  }
  // 3. Nothing new picked — drop any army selection and let province
  //    selection proceed on this same click.
  if (selectedArmyId) deselectArmy();
  return false;
}

/**
 * Right-click order for the selected army: attack a detected hostile army under
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
    if (target && !target.own) {
      const result = session.orderAttackArmy(selectedArmyId, targetArmyId);
      if (!result.ok) orderFeedback(result.reason ?? 'Invalid target.');
      refreshSelectedArmy(session);
      if (activeRenderer) syncArmyMarkers(session, activeRenderer);
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
  else void audio.playUiCue('move');
  refreshSelectedArmy(session);
  if (activeRenderer) syncArmyMarkers(session, activeRenderer);
  return true;
}

function selectArmy(session: RemoteGameSession, armyId: string): void {
  void audio.playUiCue('select');
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
  if (command === 'retreat') {
    targetingMode = 'retreat';
    awaitingMoveTarget = false;
    pushNotification('information', 'Choose retreat destination', 'Choose friendly ground away from the enemy line.');
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
  if (command.startsWith('extract-')) {
    const resource = command.slice('extract-'.length) as 'food' | 'stone' | 'metal' | 'oil';
    const result = session.orderExtract(selectedArmyId, resource);
    if (!result.ok) pushNotification('warning', 'Extract', result.reason ?? 'Cannot extract here.');
    else pushNotification('information', 'Production amplified', `Engineers are increasing ${resource} output.`);
    refreshSelectedArmy(session);
    return;
  }
  if (command.startsWith('stance-')) {
    session.orderStance(selectedArmyId, command.slice('stance-'.length) as Parameters<typeof session.orderStance>[1]);
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
  const inCloseCombat = view.status === 'engaged' && Boolean(view.battleFronts?.length);
  const combat = view.status === 'moving' ? 'moving'
    : inCloseCombat ? 'engaged'
    : view.status === 'retreating' ? 'retreating' : 'idle';
  const groups = comp?.groups.map((g) => ({
    typeId: g.typeId, label: gameUnitLabel(g.typeId), count: g.count, health: g.health,
  }));
  const activity = !session.fresh ? 'Reconnecting ? state may be stale'
    : session.pendingForArmy(view.id) ? 'Order pending confirmation' : armyActivityLabel(view.status, awaitingMoveTarget, view.own);
  const motionElapsedMs = view.motion?.sampledAtEpochMs === undefined
    ? 0 : Math.max(0, Date.now() - view.motion.sampledAtEpochMs);
  const motionDurationMs = view.motion?.durationMs ?? 0;
  const moveDisabledReason = !session.fresh
    ? 'Waiting for an authoritative update from the game server.'
    : inCloseCombat
      ? 'This formation is currently locked in close combat.'
      : view.status === 'retreating'
        ? 'This formation is withdrawing and cannot receive a new move order.'
        : NAVAL_TRANSIT_STATUSES.has(view.status)
          ? 'This formation is in transit and cannot receive a land move order.'
          : 'Movement is unavailable in the current state.';
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
      organization: comp?.organization,
      entrenchment: comp?.entrenchment,
      stance: comp?.stance,
      inSupply: comp?.inSupply,
      selected: true,
      combat,
      moveOrder: view.moveOrder,
      groups,
      speed: comp?.speed,
      attack: aggregateTroopStat(groups, 'attack', gameUnit),
      defense: aggregateTroopStat(groups, 'defense', gameUnit),
      activity,
      arrivalSeconds: view.motion ? Math.max(0, (motionDurationMs - motionElapsedMs) / 1_000) : undefined,
      movementProgress: view.motion && motionDurationMs > 0
        ? Math.min(1, motionElapsedMs / motionDurationMs) : undefined,
      own: view.own,
      canExtract: session.fresh && view.own && !view.moveOrder && session.extractableNodeAt(view.id) !== null,
      extractableResources: view.actions?.extractableResources,
      awaitingMoveTarget: view.own && awaitingMoveTarget,
      // 'strike' is a nation-level order, not an army targeting mode — the army
      // card never reflects it.
      targetingMode: view.own && targetingMode !== 'strike' ? targetingMode : null,
      canMove: session.fresh && view.own && !inCloseCombat && view.status !== 'retreating'
        && !NAVAL_TRANSIT_STATUSES.has(view.status),
      moveDisabledReason,
      canAttack: session.fresh && view.own && view.status !== 'engaged' && view.status !== 'retreating'
        && !NAVAL_TRANSIT_STATUSES.has(view.status),
      canRetreat: session.fresh && view.own && view.status === 'engaged' && Boolean(view.legalRetreatExits?.length),
      canSplit: session.fresh && view.own && view.status !== 'engaged' && view.status !== 'retreating'
        && !NAVAL_TRANSIT_STATUSES.has(view.status),
      canStop: session.fresh && view.own && view.status !== 'engaged' && view.status !== 'retreating'
        && !NAVAL_TRANSIT_STATUSES.has(view.status)
        && (Boolean(view.moveOrder) || view.status === 'extracting' || targetingMode !== null),
      shortage: view.shortage,
      supply: view.supply,
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
    resourceEconomy: summary.resourceEconomy,
    isOwn: summary.isOwn,
    occupied: summary.occupied,
    coastal: false,
    buildings: summary.isOwn
      ? ((session.state.provinceBuildings[provinceId] as {
          barracks: number; tankPlant: number; ordnance: number; missileSite: number;
        } | undefined) ?? { barracks: 0, tankPlant: 0, ordnance: 0, missileSite: 0 })
      : null,
    deposits: summary.resources
      ? { controlled: summary.controlled, extracting: summary.extracting }
      : null,
    producible: summary.isOwn
      ? session.productionOptions(provinceId).map((option) => ({
          id: option.unitTypeId, name: gameUnitLabel(option.unitTypeId), costLabel: unitCostLabel(option.unitTypeId),
          affordable: option.affordable, available: option.available, reason: option.reason,
        }))
      : [],
    // Only the head order is being worked; it carries live progress/eta.
    queue: summary.isOwn
      ? (session.state.productionQueues[provinceId] as Array<WorkOrderView & { unitTypeId: string }> ?? []).map((o, i) => ({
          id: o.unitTypeId, label: gameUnitLabel(o.unitTypeId), active: i === 0,
          progress: i === 0 ? orderPercent(o) / 100 : 0, etaSeconds: i === 0 ? orderEtaSeconds(o) : 0,
        }))
      : [],
    buildable: summary.isOwn
      ? session.buildable(provinceId).map(({ id, available, affordable, reason, targetTier }) => {
          const tier = targetTier ?? 1;
          return { id, name: `${buildingLabel(id)}${tier > 1 ? ` Level ${tier}` : ''}`,
            costLabel: buildingCostLabel(id, tier), affordable, available, reason };
        })
      : [],
    construction: summary.isOwn
      ? (session.state.constructionQueues[provinceId] as Array<WorkOrderView & { buildingId: BuildingId; targetTier?: number }> ?? []).map((o, i) => ({
          id: o.buildingId, label: `${buildingLabel(o.buildingId)}${(o.targetTier ?? 1) > 1 ? ` Level ${o.targetTier}` : ''}`, active: i === 0,
          progress: i === 0 ? orderPercent(o) / 100 : 0, etaSeconds: i === 0 ? orderEtaSeconds(o) : 0,
        }))
      : [],
    rally: summary.isOwn ? session.rallyPoint(provinceId) : null,
    commandPending: session.pendingForProvince(provinceId),
    canSetRally: summary.isOwn && session.canSetRally(provinceId),
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
const lastBombardmentNoticeAt = new Map<string, number>();
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

/** Per-front cooldowns for the continuous fight FX below. */
const lastBattleGunfireAt = new Map<string, number>();
const lastBattleArmorAt = new Map<string, number>();
const lastBattleArtilleryAt = new Map<string, number>();
const lastBattleSmokeAt = new Map<string, number>();
/** Per-province cooldown for the "city under siege" fire/smoke overlay. */
const lastCityFireAt = new Map<number, number>();

/**
 * Keep a live front visually active without mirroring every simulated round.
 * Infantry gets frequent sampled tracers; armor/artillery only emit their
 * heavier layered cues when that unit type actually exists in the visible
 * front. All effects stay inside CombatEffectPool's hard instance cap.
 */
function spawnOngoingBattleFx(session: RemoteGameSession, renderer: WorldRenderer): void {
  // The renderer already suspends GPU frames for hidden tabs; also stop creating
  // cosmetic battle records so background play costs essentially nothing here.
  if (document.hidden) return;
  const density = effectDensityForDistance(lastCombatCameraDistance);
  if (density <= 0) return;
  const now = Date.now();
  const clusters = groupEngagedByFront(
    Object.values(session.state.armies)
      .filter((a) => a.status === 'engaged')
      .map((a) => ({
        id: a.id, x: a.x, z: a.z, ownerCountryId: a.ownerCountryId,
        frontIds: (a.battleFronts ?? []).map((f) => f.id),
      })),
  );
  const worldWidth = renderer.manifest?.world.width ?? 0;
  const closeBattle = lastCombatCameraDistance <= 1_400
    && worldWidth > 0
    && [...clusters.values()].some((cluster) => wrappedDistance(
      renderer.camera.target[0], renderer.camera.target[2], cluster.x, cluster.z, worldWidth,
    ) <= 700);
  if (closeBattle) void audio.playEffectCue('close-battle');

  const activeFronts = new Set<string>();
  const activeProvinces = new Set<number>();
  for (const [frontId, cluster] of clusters) {
    activeFronts.add(frontId);
    // Distance alone is not enough: a close battle can still be behind or
    // beside the camera. Do no cosmetic spawning unless it can enter the view.
    if (!renderer.isWorldPointVisible(cluster.x, cluster.z, 220)) continue;
    const jitter = (spread: number): number => (Math.random() - 0.5) * spread;
    const members = cluster.memberIds.flatMap((id) => {
      const army = session.state.armies[id];
      return army ? [army] : [];
    });
    const armorShooter = members.find((army) => army.composition?.groups.some((group) =>
      group.count > 0 && (group.typeId.replace(/-l[2-8]$/, '') === 'light-tank' || group.typeId.replace(/-l[2-8]$/, '') === 'medium-tank')));
    const artilleryShooter = members.find((army) => army.composition?.groups.some((group) =>
      group.count > 0 && group.typeId.replace(/-l[2-8]$/, '') === 'artillery'));
    const targetFor = (shooter: (typeof members)[number]): { x: number; z: number } => {
      const enemy = members.find((army) => army.ownerCountryId !== shooter.ownerCountryId);
      if (enemy) return { x: enemy.x, z: enemy.z };
      // Fog may hide the opposing stack while this side still reports the real
      // front. Fire into a short point around the authoritative front centroid
      // rather than suppressing the cue completely.
      const fallbackDir = Math.random() * Math.PI * 2;
      return {
        x: cluster.x + Math.cos(fallbackDir) * 34,
        z: cluster.z + Math.sin(fallbackDir) * 34,
      };
    };

    if (now - (lastBattleGunfireAt.get(frontId) ?? 0) >= 420 && Math.random() <= density) {
      lastBattleGunfireAt.set(frontId, now);
      combatEffects.spawnVolley('infantry', cluster.x, cluster.z, Math.random() * Math.PI * 2, { now });
    }
    if (armorShooter
      && now - (lastBattleArmorAt.get(frontId) ?? 0) >= 10_000
      && Math.random() <= density) {
      lastBattleArmorAt.set(frontId, now);
      const target = targetFor(armorShooter);
      combatEffects.spawnTankShot(armorShooter.x, armorShooter.z, target.x, target.z, { now });
    }
    if (artilleryShooter
      && now - (lastBattleArtilleryAt.get(frontId) ?? 0) >= 12_000
      && Math.random() <= density) {
      lastBattleArtilleryAt.set(frontId, now);
      const target = targetFor(artilleryShooter);
      combatEffects.spawnArtilleryShot(artilleryShooter.x, artilleryShooter.z, target.x, target.z, { now });
    }
    if (now - (lastBattleSmokeAt.get(frontId) ?? 0) >= 1_100 && Math.random() <= 0.45 + density * 0.55) {
      lastBattleSmokeAt.set(frontId, now);
      combatEffects.spawn(EFFECT_KIND.smoke, cluster.x + jitter(26), cluster.z + jitter(26),
        { now, scale: 0.9 + Math.random() * 0.4, lifetimeMs: 2_400 });
    }

    const provinceId = renderer.provinceIdAtWorld(cluster.x, cluster.z);
    if (provinceId < 0) continue;
    const buildings = session.state.provinceBuildings[provinceId];
    const buildingCount = buildings
      ? buildings.barracks + buildings.tankPlant + buildings.ordnance + buildings.missileSite
      : 0;
    if (buildingCount <= 0) continue;
    activeProvinces.add(provinceId);
    if (now - (lastCityFireAt.get(provinceId) ?? 0) < 6_000) continue;
    lastCityFireAt.set(provinceId, now);
    for (let i = 0; i < 2; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 30 + Math.random() * 90;
      const bx = cluster.x + Math.cos(angle) * radius;
      const bz = cluster.z + Math.sin(angle) * radius;
      combatEffects.spawn(EFFECT_KIND.smoke, bx, bz, { now, scale: 1.1, lifetimeMs: 3_200 });
      combatEffects.spawn(EFFECT_KIND.explosion, bx, bz, { now, scale: 0.55, lifetimeMs: 480 });
    }
  }
  for (const id of [...lastBattleGunfireAt.keys()]) if (!activeFronts.has(id)) lastBattleGunfireAt.delete(id);
  for (const id of [...lastBattleArmorAt.keys()]) if (!activeFronts.has(id)) lastBattleArmorAt.delete(id);
  for (const id of [...lastBattleArtilleryAt.keys()]) if (!activeFronts.has(id)) lastBattleArtilleryAt.delete(id);
  for (const id of [...lastBattleSmokeAt.keys()]) if (!activeFronts.has(id)) lastBattleSmokeAt.delete(id);
  for (const id of [...lastCityFireAt.keys()]) if (!activeProvinces.has(id)) lastCityFireAt.delete(id);
}

let campaignOutcomeShown = false;
/** Enemy country ids whose "take their capital" war-aim has been announced. */
const announcedWarAims = new Set<number>();

function drainSessionEvents(session: RemoteGameSession): void {
  const player = session.playerCountryId;

  // Campaign decided — announce it once and pause the clock. The authoritative
  // sim has already frozen; this is the player-facing acknowledgement.
  const outcome = session.state.outcome;
  if (outcome && !campaignOutcomeShown) {
    campaignOutcomeShown = true;
    const won = outcome.result === 'victory';
    const day = Math.max(1, Math.floor(outcome.atGameHours / 24) + 1);
    pushNotification(won ? 'completed' : 'warning',
      won ? 'Victory' : 'Defeat',
      `${outcome.reason} Campaign ${won ? 'won' : 'lost'} on day ${day}.`,
      { sticky: true });
    uiStore.patch({ paused: true });
    void music.setState(won ? 'victory' : 'peace');
    void audio.playEffectCue(won ? 'victory' : 'defeat');
  }

  for (const alert of session.pendingShortages.splice(0)) {
    const resource = alert.resource[0].toUpperCase() + alert.resource.slice(1);
    pushNotification('warning', `${resource} shortage`,
      `National shortage pressure crossed ${alert.threshold}%. Unit penalties are now taking effect.`);
  }

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
    if (ev.kind === 'strike') {
      // Missing coords means the event lost its payload in transit — surface the
      // news without detonating a blast at the world origin.
      const sx = ev.x;
      const sz = ev.z;
      if (sx === undefined || sz === undefined || !Number.isFinite(sx) || !Number.isFinite(sz)) {
        pushNotification('combat',
          mine ? 'Strategic strike on our soil' : 'Strategic strike lands',
          mine ? 'An enemy warhead has devastated one of your provinces.'
            : 'Your warhead has devastated the target province.');
        maybePlayCombatAlert();
        continue;
      }
      // Always shown — a strategic strike is never LOD-culled. Choreographed in
      // phases so it reads as a real detonation with motion: a blinding flash
      // and core fireball, a shockwave of dust racing outward along the ground,
      // a stalk of smoke climbing from the impact point (smoke rises with age,
      // so older puffs sit higher), then a slow mushroom cap and lingering haze.
      // Held in a closure and fired either immediately or after the travelling
      // warhead below reaches the target, so the strike reads as something that
      // actually flew in rather than an instant flash at the target.
      const detonate = (): void => {
        combatEffects.spawn(EFFECT_KIND.targetFlash, sx, sz, { scale: 3.0 });
        combatEffects.spawn(EFFECT_KIND.explosion, sx, sz, { scale: 2.8 });
        for (let ring = 0; ring < 3; ring += 1) {
          window.setTimeout(() => {
            const rad = 40 + ring * 70;
            for (let k = 0; k < 8; k += 1) {
              const ang = (k / 8) * Math.PI * 2 + ring * 0.4;
              combatEffects.spawn(EFFECT_KIND.dust, sx + Math.cos(ang) * rad, sz + Math.sin(ang) * rad,
                { scale: 1.6 - ring * 0.3, lifetimeMs: 1_600 });
            }
          }, 40 + ring * 130);
        }
        for (let step = 0; step < 6; step += 1) {
          window.setTimeout(() => {
            const jitter = (step % 2 === 0 ? 1 : -1) * (6 + step * 3);
            combatEffects.spawn(EFFECT_KIND.smoke, sx + jitter, sz - jitter * 0.5,
              { scale: 1.6 + step * 0.35, lifetimeMs: 6_500 });
            if (step === 2 || step === 4) {
              combatEffects.spawn(EFFECT_KIND.explosion, sx + jitter, sz + jitter, { scale: 1.4 });
            }
          }, 120 + step * 140);
        }
        window.setTimeout(() => {
          combatEffects.spawn(EFFECT_KIND.smoke, sx, sz, { scale: 4.2, lifetimeMs: 8_000 });
          for (let k = 0; k < 4; k += 1) {
            const ang = (k / 4) * Math.PI * 2;
            combatEffects.spawn(EFFECT_KIND.smoke, sx + Math.cos(ang) * 34, sz + Math.sin(ang) * 34,
              { scale: 3.0, lifetimeMs: 7_000 });
          }
        }, 900);
        // The province keeps smouldering: a lazy plume every few seconds for ~45s
        // so a freshly struck city reads as devastated well after the blast.
        for (let wisp = 0; wisp < 9; wisp += 1) {
          window.setTimeout(() => {
            const drift = (Math.random() - 0.5) * 40;
            combatEffects.spawn(EFFECT_KIND.smoke, sx + drift, sz + (Math.random() - 0.5) * 40,
              { scale: 2.0 + Math.random() * 1.4, lifetimeMs: 5_500 });
          }, 2_500 + wisp * 4_800);
        }
        pushNotification('combat',
          mine ? 'Strategic strike on our soil' : 'Strategic strike lands',
          mine ? 'An enemy warhead has devastated one of your provinces.'
            : 'Your warhead has devastated the target province.',
          { focus: { x: sx, z: sz } });
        maybePlayCombatAlert();
      };
      // Client-only visual: find the launching country's nearest Missile Site
      // to the target so the warhead has a place to visibly fly from. Purely
      // cosmetic re-derivation — the server (src/game/strike.ts) already
      // validated a real site was in range when it resolved the strike.
      let launchX: number | undefined;
      let launchZ: number | undefined;
      let bestDist = Infinity;
      const worldWidth = activeRenderer?.manifest?.world.width ?? 0;
      for (const [pidRaw, buildings] of Object.entries(session.state.provinceBuildings)) {
        if (!buildings.missileSite) continue;
        const pid = Number(pidRaw);
        if (session.state.provinceOwners[pid] !== ev.attacker) continue;
        const center = activeRenderer?.provinceCenter(pid);
        if (!center) continue;
        const d = wrappedDistance(center[0], center[1], sx, sz, worldWidth);
        if (d < bestDist) { bestDist = d; launchX = center[0]; launchZ = center[1]; }
      }
      if (launchX !== undefined && launchZ !== undefined) {
        // A visible warhead travels from the launch site to the target over a
        // few seconds before the detonation choreography above plays.
        const travelMs = 2_800;
        const start = performance.now();
        const lx = launchX;
        const lz = launchZ;
        // Shortest signed X delta, not a raw subtraction — the map wraps
        // horizontally, and a site near one edge can legitimately be in range
        // of a target near the other.
        const dx = wrappedDeltaX(lx, sx, worldWidth);
        const dz = sz - lz;
        const dir = Math.atan2(dz, dx);
        combatEffects.spawn(EFFECT_KIND.muzzleFlash, lx, lz, { dir, scale: 1.4 });
        const step = (): void => {
          const t = Math.min(1, (performance.now() - start) / travelMs);
          const px = lx + dx * t;
          const pz = lz + dz * t;
          combatEffects.spawn(EFFECT_KIND.projectile, px, pz, { dir, scale: 1.6, lifetimeMs: 260 });
          if (t < 1) window.setTimeout(step, 70);
          else detonate();
        };
        step();
      } else {
        detonate();
      }
      continue;
    }
    // World-space visuals for the same event, near-camera only (LOD gated).
    if (fxDensity > 0) {
      const atkSpot = battleSpotFor(ev.attacker, ev.attacker);
      const defSpot = battleSpotFor(ev.defender, ev.defender) ?? battleSpotFor(ev.attacker, ev.defender);
      const spot = ev.x !== undefined && ev.z !== undefined ? { x: ev.x, z: ev.z } : defSpot ?? atkSpot;
      const dir = atkSpot && defSpot
        ? Math.atan2(defSpot.z - atkSpot.z, defSpot.x - atkSpot.x)
        : Number.NaN;
      if (spot) {
        if (ev.kind === 'engaged') {
          combatEffects.spawnVolley('generic', spot.x, spot.z, Number.isFinite(dir) ? dir : 0);
          if (mine) combatEffects.spawn(EFFECT_KIND.targetFlash, spot.x, spot.z, { scale: 1.1 });
        } else if (ev.kind === 'combatPulse') {
          combatEffects.spawnVolley('infantry', spot.x, spot.z, Number.isFinite(dir) ? dir : 0);
        } else if (ev.kind === 'bombardment') {
          const impactAt = defSpot ?? spot;
          if (atkSpot) {
            combatEffects.spawnArtilleryShot(atkSpot.x, atkSpot.z, impactAt.x, impactAt.z);
          } else {
            // Projection can hide the firing stack; keep the authoritative
            // impact readable without inventing a fake launch position.
            combatEffects.spawn(EFFECT_KIND.explosion, impactAt.x, impactAt.z, { scale: 1.3 });
            combatEffects.spawn(EFFECT_KIND.smoke, impactAt.x, impactAt.z, { scale: 1.2, lifetimeMs: 2_400 });
          }
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
      // Continuous artillery emits frequent visual pulses. Keep those effects,
      // but rate-limit the corresponding toast per pair of belligerents.
      const noticeKey = `${ev.attacker}:${ev.defender}`;
      const now = Date.now();
      if (now - (lastBombardmentNoticeAt.get(noticeKey) ?? 0) >= 30_000) {
        lastBombardmentNoticeAt.set(noticeKey, now);
        pushNotification('combat', mine ? 'Under bombardment' : 'Artillery firing',
          mine ? 'Enemy artillery is shelling one of your armies.' : 'Your artillery is firing continuously.');
      }
    } else if (ev.kind === 'reinforced') {
      pushNotification('combat', 'Battle reinforced', 'Another army has joined an active direction.');
    } else if (ev.kind === 'battleEnded') {
      const involved = ev.attacker === player || ev.defender === player;
      if (!involved) {
        pushNotification('information', 'Battle ended', 'Surviving armies are resuming valid orders.');
      } else if (ev.survivorCountryId === player) {
        pushNotification('combat', 'Battle won', 'Your forces held the field; survivors are resuming orders.');
      } else if (ev.survivorCountryId === null) {
        pushNotification('combat', 'Battle ended in mutual destruction', 'Neither side held the field.');
      } else {
        pushNotification('warning', 'Battle lost', 'Your forces were driven from the field.');
      }
    }
  }
  for (const cap of session.pendingCaptures.splice(0)) {
    if (selectedProvinceId === cap.provinceId) refreshSelectedProvince(session);
    // Only surface captures the player is involved in.
    if (cap.toCountryId !== player && cap.fromCountryId !== player) continue;
    const to = session.state.countries[cap.toCountryId]?.name ?? '?';
    const from = session.state.countries[cap.fromCountryId]?.name ?? '?';
    pushNotification('combat',
      cap.toCountryId === player ? 'Province captured' : 'Province lost',
      cap.toCountryId === player ? `Taken from ${from}` : `${to} took it from you`);
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
  const sticky = isSticky(kind, options.sticky);
  const previous = uiStore.get().notifications;
  const delay = autoDismissDelay(kind, options.sticky);

  // Fold a burst of identical events (same kind + title, e.g. "Province captured"
  // through an offensive) into the existing toast with a running "×N" tally
  // rather than letting near-duplicate cards crowd the stack. Never merge a
  // toast that carries a focus point (a located battle you can click to fly to)
  // or a sticky one — each of those points somewhere specific.
  const twin = options.focus
    ? undefined
    : previous.find((entry) => entry.kind === kind && entry.title === title
        && !entry.sticky && !entry.focus);
  if (twin) {
    const merged = { ...twin, body, at: Date.now(), count: (twin.count ?? 1) + 1 };
    uiStore.patch({ notifications: previous.map((entry) => (entry.id === twin.id ? merged : entry)) });
    if (delay !== null) {
      clearNotificationTimer(twin.id);
      notificationTimers.set(twin.id, window.setTimeout(() => removeNotification(twin.id), delay));
    }
    return;
  }

  const id = `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const notifications = [...previous, { id, kind, title, body, at: Date.now(), sticky, focus: options.focus }].slice(-4);
  // Anything the last-4 cap just dropped no longer needs its auto-dismiss timer.
  const kept = new Set(notifications.map((entry) => entry.id));
  for (const entry of previous) if (!kept.has(entry.id)) clearNotificationTimer(entry.id);
  uiStore.patch({ notifications });
  if (delay !== null) {
    notificationTimers.set(id, window.setTimeout(() => removeNotification(id), delay));
  }
}

function diplomacyRelation(session: RemoteGameSession, countryId: number): 'neutral' | 'allied' | 'war' {
  const a = Math.min(session.playerCountryId, countryId);
  const b = Math.max(session.playerCountryId, countryId);
  const relation = session.state.relations[`${a}:${b}`] ?? 'peace';
  return relation === 'allied' || relation === 'war' ? relation : 'neutral';
}

function sameDiplomacyView(previous: DiplomacyView, next: DiplomacyView): boolean {
  const sameCountries = previous.countries.length === next.countries.length
    && previous.countries.every((country: DiplomacyCountryView, index) => {
      const candidate = next.countries[index];
      return country.id === candidate.id && country.name === candidate.name
        && country.color === candidate.color && country.controller === candidate.controller
        && country.alive === candidate.alive && country.relation === candidate.relation
        && country.unreadCount === candidate.unreadCount
        && country.incomingProposalCount === candidate.incomingProposalCount;
    });
  const sameMessages = previous.messages.length === next.messages.length
    && previous.messages.every((message: DiplomacyMessageView, index) => {
      const candidate = next.messages[index];
      return message.id === candidate.id && message.fromCountryId === candidate.fromCountryId
        && message.toCountryId === candidate.toCountryId && message.body === candidate.body
        && message.sentAtTick === candidate.sentAtTick;
    });
  const sameProposals = previous.proposals.length === next.proposals.length
    && previous.proposals.every((proposal: DiplomacyProposalView, index) => {
      const candidate = next.proposals[index];
      return proposal.id === candidate.id && proposal.fromCountryId === candidate.fromCountryId
        && proposal.toCountryId === candidate.toCountryId && proposal.kind === candidate.kind
        && proposal.status === candidate.status && proposal.createdAtTick === candidate.createdAtTick
        && proposal.resolvedAtTick === candidate.resolvedAtTick;
    });
  return previous.viewerCountryId === next.viewerCountryId
    && previous.selectedCountryId === next.selectedCountryId
    && previous.busy === next.busy && previous.feedback === next.feedback
    && sameCountries && sameMessages && sameProposals;
}

/**
 * Cheap fingerprint of everything the diplomacy view actually depends on.
 * `session.state` is a fresh `structuredClone` on every server update (see
 * replica-store.ts), so `projection.countries`/`.relations`/`.diplomacy` never
 * hold a stable reference to compare against even when nothing diplomatic
 * changed — only a value-based signature can tell. Linear in country count
 * with plain string concatenation, versus the full rebuild below which sorts
 * the roster and, for every country, filters the messages/proposals arrays.
 */
let lastDiplomacySignature = '';
function diplomacySignature(projection: RemoteGameSession['state']): string {
  const diplomacy = projection.diplomacy ?? { messages: [], proposals: [] };
  const relations = Object.keys(projection.relations).sort()
    .map((key) => `${key}:${projection.relations[key]}`).join(',');
  const messages = diplomacy.messages.map((m) => `${m.id}:${m.toCountryId}`).join(',');
  const proposals = diplomacy.proposals.map((p) => `${p.id}:${p.status}`).join(',');
  // name/color/controller are effectively immutable once a country exists;
  // only id + alive (capitulation) actually needs to be tracked here.
  let countries = '';
  for (const country of Object.values(projection.countries)) countries += `${country.id}${country.alive ? 1 : 0}`;
  return `${relations}|${messages}|${proposals}|${countries}`;
}

function syncDiplomacyView(session: RemoteGameSession, selectedCountryId?: number): void {
  const projection = session.state;
  const diplomacy = projection.diplomacy ?? { messages: [], proposals: [] };
  if (!diplomacyBootstrapped) {
    for (const message of diplomacy.messages) announcedDiplomacyItems.add(`message:${message.id}`);
    for (const proposal of diplomacy.proposals) announcedDiplomacyItems.add(`proposal:${proposal.id}`);
    diplomacyBootstrapped = true;
  }
  for (const message of diplomacy.messages) {
    const key = `message:${message.id}`;
    if (!announcedDiplomacyItems.has(key) && message.toCountryId === projection.viewerCountryId) {
      pushNotification('diplomacy', 'Incoming diplomatic cable',
        `${projection.countries[message.fromCountryId]?.name ?? 'Foreign office'} sent a message.`);
      announcedDiplomacyItems.add(key);
    }
  }
  for (const proposal of diplomacy.proposals) {
    const key = `proposal:${proposal.id}`;
    const previousStatus = diplomacyProposalStatuses.get(proposal.id);
    if (previousStatus && previousStatus !== proposal.status && proposal.fromCountryId === projection.viewerCountryId) {
      const other = projection.countries[proposal.toCountryId]?.name ?? 'Foreign office';
      pushNotification('diplomacy', 'Diplomatic proposal resolved', `${other} ${proposal.status} your ${proposal.kind} proposal.`);
    }
    diplomacyProposalStatuses.set(proposal.id, proposal.status);
    if (!announcedDiplomacyItems.has(key) && proposal.toCountryId === projection.viewerCountryId
      && proposal.status === 'pending') {
      pushNotification('diplomacy', 'Diplomatic proposal received',
        `${projection.countries[proposal.fromCountryId]?.name ?? 'Foreign office'} sent a ${proposal.kind} proposal.`);
      announcedDiplomacyItems.add(key);
    }
  }
  // The explicit-selection call sites (picking a country in the panel) always
  // need to rebuild since `target` below can change with nothing else
  // different; the periodic/event-driven calls only need to when something
  // diplomacy actually cares about changed.
  if (selectedCountryId === undefined) {
    const signature = diplomacySignature(projection);
    if (signature === lastDiplomacySignature) return;
    lastDiplomacySignature = signature;
  } else {
    lastDiplomacySignature = diplomacySignature(projection);
  }
  const current = uiStore.get().diplomacy;
  const target = selectedCountryId ?? current.selectedCountryId;
  const countries = Object.values(projection.countries)
    .filter((country) => country.id !== projection.viewerCountryId)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((country) => {
      const messages = diplomacy.messages.filter((message) =>
        (message.fromCountryId === projection.viewerCountryId && message.toCountryId === country.id)
        || (message.toCountryId === projection.viewerCountryId && message.fromCountryId === country.id));
      const incoming = diplomacy.proposals.filter((proposal) =>
        proposal.status === 'pending' && proposal.toCountryId === projection.viewerCountryId
        && proposal.fromCountryId === country.id).length;
      return {
        id: country.id, name: country.name, color: country.color, controller: country.controller,
        alive: country.alive, relation: diplomacyRelation(session, country.id),
        unreadCount: messages.filter((message) => message.toCountryId === projection.viewerCountryId
          && !readDiplomacyMessages.has(message.id)).length,
        incomingProposalCount: incoming,
      };
    });
  const selected = countries.some((country) => country.id === target) ? target : (countries[0]?.id ?? null);
  const selectedMessages = selected === null ? [] : diplomacy.messages.filter((message) =>
    (message.fromCountryId === projection.viewerCountryId && message.toCountryId === selected)
    || (message.toCountryId === projection.viewerCountryId && message.fromCountryId === selected));
  const selectedProposals = selected === null ? [] : diplomacy.proposals.filter((proposal) =>
    proposal.fromCountryId === selected || proposal.toCountryId === selected);
  const next: DiplomacyView = {
    viewerCountryId: projection.viewerCountryId,
    countries,
    selectedCountryId: selected,
    messages: selectedMessages,
    proposals: selectedProposals,
    busy: current.busy,
    feedback: current.feedback,
  };
  if (!sameDiplomacyView(current, next)) uiStore.patch({ diplomacy: next });
}

function markDiplomacyRead(session: RemoteGameSession, countryId: number): void {
  for (const message of session.state.diplomacy?.messages ?? []) {
    if (message.fromCountryId === countryId || message.toCountryId === countryId) readDiplomacyMessages.add(message.id);
  }
}

function diplomacyCommand(
  session: RemoteGameSession, action: DiplomacyBusyAction, send: (done: (ok: boolean) => void) => { ok: true },
): void {
  uiStore.patch({ diplomacy: { ...uiStore.get().diplomacy, busy: action, feedback: null } });
  send((ok) => {
    const labels: Record<DiplomacyBusyAction, string> = {
      message: 'Cable sent.', alliance: 'Alliance proposal sent.', peace: 'Peace offer sent.',
      'declare-war': 'War declared.', 'end-alliance': 'Alliance ended.', 'proposal-response': 'Proposal response sent.',
    };
    uiStore.patch({ diplomacy: { ...uiStore.get().diplomacy, busy: null, feedback: ok ? labels[action] : 'Command rejected.' } });
    syncDiplomacyView(session);
  });
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
  const line = (
    id: ResourceLine['id'], label: string, value: number, key?: keyof typeof s,
  ): ResourceLine => ({
    id, label, value: Math.round(value),
    delta: key ? Number((country.netIncome?.[key] ?? inc[key]).toFixed(1)) : undefined,
    production: key ? Number(inc[key].toFixed(1)) : undefined,
    upkeep: key ? Number((country.upkeep?.[key] ?? 0).toFixed(1)) : undefined,
    coverage: key && key !== 'manpower' && key !== 'stone' ? country.coverage?.[key] : 1,
    reserveHours: key && key !== 'manpower' && key !== 'stone' ? country.reserveHours?.[key] : null,
    shortageSeverity: key && key !== 'manpower' && key !== 'stone' ? country.shortages?.[key]?.severity : 0,
  });
  const lines = [
    line('money', 'Funds', s.funds, 'funds'),
    line('manpower', 'Manpower', s.manpower, 'manpower'),
    line('food', 'Food', s.food, 'food'),
    // stone/metal/oil have no passive income — the rate is current extraction.
    line('stone', 'Stone', s.stone, 'stone'),
    line('metal', 'Metal', s.metal, 'metal'),
    line('oil', 'Oil', s.oil, 'oil'),
  ];
  // Only surfaced once a warhead is ready — a rare mechanic, not permanent
  // clutter. The chip is the discovery hook for the N-to-strike order.
  const warheads = Math.floor(country.warheads ?? 0);
  if (warheads >= 1) lines.push(line('warheads', 'Warheads', warheads));
  return lines;
}

const RESOURCE_TOOLTIP_CHIPS = [
  ['food', 'food'], ['stone', 'node-stone'], ['metal', 'node-metal'], ['oil', 'node-oil'],
] as const;

function updateTooltip(
  info: HoverInfo | null, x: number, y: number, potential: Record<string, number> | null,
): void {
  if (!info) {
    tooltip.hidden = true;
    return;
  }
  tooltipName.textContent = info.name;
  const ownerId = activeSession?.state.provinceOwners[info.id];
  tooltipTerrain.textContent = debugEnabled
    ? `${info.country} · Country #${ownerId ?? 0} · ${info.terrain} · Province #${info.id}`
    : `${info.country} · ${info.terrain}`;
  const chips = potential
    ? RESOURCE_TOOLTIP_CHIPS
        .map(([key, icon]) =>
          `<span class="tooltip-rchip">${iconMarkup(icon)}${Math.round((potential[key] ?? 0) * 100)}%</span>`)
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
  10: { description: 'Server-generated food potential. Exact foreign values require a debug-enabled deployment.', legend: [['low', '#071017'], ['medium', '#1abcaa'], ['world class', '#ffca1f']] },
  11: { description: 'Server-generated stone potential. Exact foreign values require a debug-enabled deployment.', legend: [['low', '#071017'], ['medium', '#1abcaa'], ['world class', '#ffca1f']] },
  12: { description: 'Server-generated metal potential. Exact foreign values require a debug-enabled deployment.', legend: [['low', '#071017'], ['medium', '#1abcaa'], ['world class', '#ffca1f']] },
  13: { description: 'Server-generated oil potential. Exact foreign values require a debug-enabled deployment.', legend: [['low', '#071017'], ['medium', '#1abcaa'], ['world class', '#ffca1f']] },
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
