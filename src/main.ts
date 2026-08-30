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
import type { SessionResponse } from '@ironfronts/protocol';
import { buildArmyFormation, dominantVisualKind } from './army-map-presentation';

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
const music = new MusicDirector(audio);
const firstMenuTrack = TRACK_BY_ID.get('honor-bound');
audio.prime(firstMenuTrack ? trackSources(firstMenuTrack).slice(0, 1) : []);
audio.installLifecycle();

// Try to start the lobby soundtrack immediately when the page opens. Browsers
// are allowed to block audible autoplay after a navigation/refresh, so a real
// user gesture owns AudioContext activation. Keep the recovery listeners
// available instead of consuming them after one attempt: Chrome can reject an
// early resume (or re-suspend audio after a tab visibility change).
void music.setState('menu');

let menuMusicHasPlayed = false;
let audioGestureRecoveryInFlight = false;
const recoverAudioAfterGesture = (): void => {
  if (audioGestureRecoveryInFlight) return;
  audioGestureRecoveryInFlight = true;
  void (async () => {
    try {
      if (!await audio.unlock()) return;

      // The initial autoplay attempt may have left the director in "menu"
      // state even though no track actually started. Retry only until menu
      // music has successfully played once; normal director gaps afterwards
      // must remain intentional.
      if (!menuMusicHasPlayed && music.getState() === 'menu' && !audio.isMusicPlaying()) {
        await music.setState('menu', { force: true });
      }
      if (audio.isMusicPlaying()) menuMusicHasPlayed = true;
    } finally {
      audioGestureRecoveryInFlight = false;
    }
  })();
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
  onLogout: () => { void logout().finally(() => window.location.replace('/login.html')); },
  onLaunch: async (countryId: number) => {
    if (rendererStarted) return;
    rendererStarted = true;
    try {
      if (lobby.assignedCountryId === null) await joinGame(countryId);
      await music.setState('opening');

    // The lobby is deliberately lightweight. The world canvas, loading scene,
    // renderer module graph, WebGPU device and world assets are all deferred
    // until the player actually commits to an operation.
    if (!navigator.gpu) {
      loading.hidden = true;
      canvas.hidden = true;
      unsupported.hidden = false;
    } else {
      canvas.hidden = false;
      loading.hidden = false;
      loadingStage.textContent = 'Loading renderer';
      loadingValue.textContent = '0%';
      loadingBar.style.width = '0%';
      debugToggle.hidden = !debugEnabled;
      // The legacy MAP OVERLAY fieldset stays in the DOM (main.ts reads its
      // radios) but is superseded by the in-game map-mode toolbar.
      mapModes.hidden = true;
      uiStore.patch({ phase: 'loading' });
      await start();
    }
    } catch (error) {
      rendererStarted = false;
      throw error;
    }
  },
  // In the lobby this only persists; once the renderer exists it applies live.
  onGraphicsQuality: (level) => activeRenderer?.setQuality(level),
});

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

async function start(): Promise<void> {
  const stopQuotes = startLoadingQuotes();
  const connection = await GameConnection.open();
  activeConnection = connection;
  configureWorldAssetBase(connection.world.assetBaseUrl);
  const session = new RemoteGameSession(connection, (reason) => {
    pushNotification('warning', 'Command failed', reason);
    window.setTimeout(() => {
      uiStore.patch({ notifications: uiStore.get().notifications.filter((entry) => entry.title !== 'Command failed') });
    }, 4_000);
  });
  activeSession = session;

  // Keep the complete renderer/world module graph out of the lobby bundle.
  // This import is the first point at which world rendering code is loaded.
  const { WorldRenderer } = await import('./renderer');
  const renderer = new WorldRenderer(canvas, countryLabels, loadQuality());
  activeRenderer = renderer;
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) renderer.dispose();
  });
  if (import.meta.env.DEV || debugEnabled) {
    // Invisible automation handle (QA capture / perf scripts). Not a player-
    // facing affordance.
    (window as Window & { __ironfrontsRenderer?: WorldRenderer }).__ironfrontsRenderer = renderer;
  }
  // Hover deposits come from the fog-aware GameSession projection once it
  // exists; before that (and for water) show no deposit chips. The renderer's
  // own natural-resource table bypasses fog and must not drive player hover.
  renderer.onHover = (info, x, y) =>
    updateTooltip(info, x, y, info && activeSession
      ? activeSession.describeProvince(info.id).resources
      : null);

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
    dismissNotification: (id) => uiStore.patch({
      notifications: uiStore.get().notifications.filter((entry) => entry.id !== id),
    }),
    togglePause: (open) => uiStore.patch({ paused: open }),
    toggleResourceOverlay: (on) => {
      renderer.setResourceOverlay(on);
      uiStore.patch({ resourceOverlay: on });
    },
    returnToMenu: () => { /* Disabled in the UI until a safe menu-return path exists. */ },
    openDebugInspector: () => {
      if (debugEnabled) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F3', key: 'F3' }));
    },
    armyCommand: (command) => handleArmyCommand(command),
    produceUnit: (provinceId, unitTypeId) => handleProduce(provinceId, unitTypeId),
    buildStructure: (provinceId, buildingId) => handleBuild(provinceId, buildingId),
    rallyPoint: (provinceId, action) => handleRally(provinceId, action),
  };
  const gameUi = mountGameUi(uiStore, gameUiActions);
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) gameUi.destroy();
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
  });
  for (const preset of debugTimePresets) {
    preset.addEventListener('click', () => renderer.setTimeOfDay(Number(preset.dataset.debugTime)));
  }
  const applyTimeMultiplier = () => {
    if (debugTimeMultiplier.value === '') return;
    const multiplier = renderer.setTimeMultiplier(Number(debugTimeMultiplier.value));
    debugTimeMultiplier.value = multiplier.toFixed(1);
  };
  debugTimeMultiplier.addEventListener('change', applyTimeMultiplier);
  debugTimeMultiplier.addEventListener('blur', applyTimeMultiplier);
  debugRain.addEventListener('change', () => {
    renderer.setRainEnabled(debugRain.checked);
    void audio.setRainEnabled(debugRain.checked);
    uiStore.patch({ weather: { raining: debugRain.checked, label: debugRain.checked ? 'Rain' : 'Clear' } });
  });
  debugThunder.addEventListener('click', () => {
    void audio.playThunder();
  });

  for (const tab of debugTabs) {
    tab.addEventListener('click', () => {
      const selected = tab.dataset.debugTab;
      for (const candidate of debugTabs) candidate.setAttribute('aria-selected', String(candidate === tab));
      for (const panel of debugPanels) panel.hidden = panel.dataset.debugPanel !== selected;
    });
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
  });

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
    });
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
  debugToggle.addEventListener('click', toggleDiagnostics);
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
  });
  for (const input of mapModeInputs) input.addEventListener('change', applyMapMode);
  applyMapMode();
  debugView.addEventListener('change', applyDebugView);
  debugWireframe.addEventListener('change', () => renderer.setWireframe(debugWireframe.checked));
  debugCountries.addEventListener('change', () => renderer.setCountryOverlayVisible(debugCountries.checked));
  debugBorders.addEventListener('change', () => renderer.setBordersVisible(debugBorders.checked));
  debugRoads.addEventListener('change', () => renderer.setRoadsVisible(debugRoads.checked));
  debugHidden.addEventListener('change', () => renderer.setHiddenConnectionsVisible(debugHidden.checked));
  debugWaterways.addEventListener('change', () => renderer.setWaterwaysVisible(debugWaterways.checked));
  debugProps.addEventListener('change', () => renderer.setPropsVisible(debugProps.checked));
  debugConnections.addEventListener('change', async () => {
    debugConnections.disabled = true;
    try {
      await renderer.setConnectionsVisible(debugConnections.checked);
    } finally {
      debugConnections.disabled = false;
    }
  });
  debugRivers.addEventListener('change', async () => {
    debugRivers.disabled = true;
    try {
      await renderer.setWaterwayNetworkVisible(debugRivers.checked);
    } finally {
      debugRivers.disabled = false;
    }
  });
  try {
    await renderer.initialize((stage, progress) => {
      const percentage = Math.round(progress * 100);
      loadingStage.textContent = stage;
      loadingValue.textContent = `${percentage}%`;
      loadingBar.style.width = `${percentage}%`;
    });
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
    loading.classList.add('is-done');
    stopQuotes();
    window.setTimeout(() => { loading.hidden = true; }, 500);
    renderer.start();

    // ---- Authoritative game session (Phase A wiring) -----------------
    // The renderer is now a data source + presentation cache; GameSession owns
    // gameplay state. Build WorldData from the loaded package and start the
    // fixed-step simulation.
    try {
      await bootstrapGameSession(renderer, session);
    } catch (sessionError) {
      console.error('GameSession bootstrap failed; renderer stays up.', sessionError);
    }

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
      // Dev-only fixtures so screenshots / component tests have content. Never
      // shown in production gameplay.
      uiStore.patch({ notifications: DEMO_NOTIFICATIONS, selectedArmy: DEMO_ARMY });
    }
  } catch (error) {
    stopQuotes();
    void audio.setWindEnabled(false);
    void audio.setOceanEnabled(false);
    console.error(error);
    loading.hidden = true;
    unsupported.hidden = false;
    const title = unsupported.querySelector('h1');
    const message = unsupported.querySelector('p:last-child');
    if (title) title.textContent = 'The world could not be rendered.';
    if (message) message.textContent = error instanceof Error ? error.message : String(error);
  }
}

function updateTimeControls(state: TimeOfDayState): void {
  debugTimeState.textContent = `${state.stage} · ${state.clock}`;
  if (document.activeElement !== debugTime) debugTime.value = state.clock;
  if (document.activeElement !== debugTimeMultiplier) debugTimeMultiplier.value = state.multiplier.toFixed(1);
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
  renderer.setPlayerCountryByName(player.name);
  const { x, z, distance } = session.state.startCamera;
  renderer.focus(x, z, distance);

  // Map-tap -> army selection / move order. Consumes the click so
  // it does not also select a province.
  renderer.onMapClick = (clientX, clientY) => handleMapClick(renderer, session, clientX, clientY);
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
    refreshSelectedArmy(session);
    refreshSelectedProvince(session); // keep production / construction % live
    drainSessionEvents(session);
  }, 400);
  const onKey = (event: KeyboardEvent): void => {
    if (event.repeat || !selectedArmyId) return;
    if (event.key === 'm' || event.key === 'M') {
      targetingMode = 'move'; awaitingMoveTarget = true; refreshSelectedArmy(session);
    } else if (event.key === 's' || event.key === 'S') {
      session.orderStop(selectedArmyId); targetingMode = null; awaitingMoveTarget = false; refreshSelectedArmy(session);
    }
    else if (event.key === 'e' || event.key === 'E') { handleArmyCommand('extract'); }
    else if (event.key === 'Escape') { deselectArmy(); }
  };
  window.addEventListener('keydown', onKey);
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) {
      window.clearInterval(hudTimer);
      window.clearInterval(civilClockTimer);
      window.removeEventListener('keydown', onKey);
      if (activeSession === session) activeSession = undefined;
      activeConnection?.close();
    }
  });

  console.info(
    `[game] ${player.name} connected — camera @ ${Math.round(x)},${Math.round(z)}`,
  );
}

const armyMarkerScratch = new Float32Array(8 * 1_024);
const armyModelScratch = new Float32Array(12 * 4_096);
const resourceMarkerScratch = new Float32Array(4 * 4_096);
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

/**
 * Rebuild the renderer's army-stack marker buffer from authoritative GameState,
 * fog-gated: own stacks always shown; foreign stacks only when in
 * contact/vision; hidden stacks omitted entirely.
 */
const armyPickScratch: Array<{ id: string; x: number; z: number }> = [];
const previousArmyModelPositions = new Map<string, { x: number; z: number }>();

function syncArmyMarkers(
  session: RemoteGameSession, renderer: WorldRenderer,
): void {
  let cursor = 0;
  let count = 0;
  let modelCursor = 0;
  let modelCount = 0;
  const activeModelKeys = new Set<string>();
  armyPickScratch.length = 0;
  for (const army of Object.values(session.state.armies)) {
    if (count >= 1_024) break;
    const identified = army.contact === 'visible';
    const formation = identified ? buildArmyFormation(army.composition?.groups ?? []) : [];
    armyMarkerScratch[cursor] = army.x;
    armyMarkerScratch[cursor + 1] = army.z;
    armyMarkerScratch[cursor + 2] = packRgb(army.ownerColor);
    armyMarkerScratch[cursor + 3] = identified ? 1 : 2;
    // Contact markers render as '?'; don't ship the real strength/health.
    armyMarkerScratch[cursor + 4] = identified ? army.composition?.unitCount ?? 0 : 0;
    armyMarkerScratch[cursor + 5] = identified ? army.composition?.health ?? 0 : 0;
    armyMarkerScratch[cursor + 6] = army.id === selectedArmyId ? 1 : 0;
    armyMarkerScratch[cursor + 7] = identified ? dominantVisualKind(formation) : 4;
    cursor += 8;
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
      cursor += 8;
      count += 1;
    }
    if (army.id === selectedArmyId && army.status === 'engaged') {
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
        cursor += 8;
        count += 1;
      }
    }

    if (identified && formation.length) {
      const target = army.moveOrder;
      const heading = target ? Math.atan2(target.x - army.x, -(target.z - army.z)) : 0;
      const forwardX = Math.sin(heading);
      const forwardZ = -Math.cos(heading);
      const rightX = Math.cos(heading);
      const rightZ = Math.sin(heading);
      const slots: ReadonlyArray<readonly [number, number]> = [
        [-11, -9], [11, -9], [-11, 9], [11, 9],
      ];
      for (let index = 0; index < formation.length && modelCount < 4_096; index += 1) {
        const group = formation[index];
        const [right, forward] = slots[index];
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
        armyModelScratch[modelCursor + 11] = 0;
        previousArmyModelPositions.set(modelKey, { x, z });
        modelCursor += 12;
        modelCount += 1;
      }
    }
  }
  for (const key of previousArmyModelPositions.keys()) {
    if (!activeModelKeys.has(key)) previousArmyModelPositions.delete(key);
  }
  renderer.setArmyMarkers(armyMarkerScratch, count, armyPickScratch, armyModelScratch, modelCount);
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
      if (!result.ok) pushNotification('warning', targetingMode === 'split' ? 'Split' : 'Move order', result.reason ?? 'No route.');
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
    const result = targetArmyId && targetArmyId !== selectedArmyId
      ? session.orderAttackArmy(selectedArmyId, targetArmyId)
      : (() => {
        const provinceId = renderer.provinceIdAt(clientX, clientY);
        return provinceId >= 0
          ? session.orderAttackProvince(selectedArmyId!, provinceId)
          : { ok: false as const, reason: 'Select an army or province center.' };
      })();
    if (!result.ok) pushNotification('warning', 'Attack order', result.reason ?? 'Invalid target.');
    targetingMode = null;
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
      return;
    }
    const result = session.orderRetreat(selectedArmyId, firstNodeId);
    if (!result.ok) pushNotification('warning', 'Retreat', result.reason ?? 'No legal retreat.');
    refreshSelectedArmy(session);
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
    deposits: summary.resources
      ? { controlled: summary.controlled, extracting: summary.extracting }
      : null,
    producible: summary.isOwn
      ? session.producible(provinceId).map((id) => ({
          id, name: gameUnitLabel(id), costLabel: unitCostLabel(id),
        }))
      : [],
    // Only the head order is being worked; tag it with its % so the player can
    // see how close the next unit / building is.
    queue: summary.isOwn
      ? (session.state.productionQueues[provinceId] as Array<{ unitTypeId: string; progressHours: number; totalHours: number }> ?? []).map((o, i) =>
          i === 0 ? `${gameUnitLabel(o.unitTypeId)} · ${orderPercent(o)}%` : gameUnitLabel(o.unitTypeId))
      : [],
    buildable: summary.isOwn
      ? session.buildable(provinceId).map(({ id, affordable }) => ({
          id, name: buildingLabel(id), costLabel: buildingCostLabel(id), affordable,
        }))
      : [],
    construction: summary.isOwn
      ? (session.state.constructionQueues[provinceId] as Array<{ buildingId: BuildingId; progressHours: number; totalHours: number }> ?? []).map((o, i) =>
          i === 0 ? `${buildingLabel(o.buildingId)} · ${orderPercent(o)}%` : buildingLabel(o.buildingId))
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
  for (const ev of session.pendingCombat.splice(0)) {
    // Only fights the player is in are player news. 'engaged' is gated to the
    // moment contact is made, so it fires once per battle, not every tick.
    if (ev.attacker !== player && ev.defender !== player) continue;
    const mine = ev.defender === player;
    if (ev.kind === 'engaged') {
      pushNotification('combat', mine ? 'Under attack' : 'Contact',
        mine ? 'Enemy forces have engaged your line.' : 'Your forces have made contact.');
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

function pushNotification(kind: GameNotification['kind'], title: string, body?: string): void {
  const notifications = [...uiStore.get().notifications, {
    id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    kind, title, body, at: Date.now(),
  }].slice(-4);
  uiStore.patch({ notifications });
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
    // stone/metal/oil have no passive rate — physical extraction only.
    line('stone', 'Stone', s.stone),
    line('metal', 'Metal', s.metal),
    line('oil', 'Oil', s.oil),
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
