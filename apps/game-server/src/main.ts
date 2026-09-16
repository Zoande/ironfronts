import {
  GAME_ID, GAME_VERSION,
} from '@ironfronts/protocol';
import { config } from './config';
import { loadWorld } from './world-loader';
import { GameRuntime } from './runtime';
import { ProjectionPublisher } from './publisher';
import { SimulationScheduler } from './scheduler';
import { AuthoritativeGameClock } from './game-clock';
import {
  CLOCK_SYNC_INTERVAL_MS, SIMULATION_INTERVAL_MS, clampSimSpeed, offlineSimulationHours,
} from './timing';
import { GamePersistence, type PersistedGame } from './persistence';
import { createInternalApiServer } from './internal-api';
import { GameplayGateway } from './gameplay-gateway';
import { DiagnosticLog, type DiagnosticLevel } from './diagnostic-log';

const diagnosticLog = new DiagnosticLog(config.diagnosticsPath);
const consoleInfoEvents = new Set(['listening', 'diagnostics_file_enabled']);
const fileOnlyEvents = new Set(['server_health', 'slow_projection_publish']);
function log(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}): void {
  const record = { ...fields, timestamp: new Date().toISOString(), level, service: 'game-server', event };
  if (!fileOnlyEvents.has(event) && (level !== 'info' || consoleInfoEvents.has(event))) {
    console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](JSON.stringify(record));
  }
  diagnosticLog.write(level, 'game-server', event, fields);
}
function clientLog(level: DiagnosticLevel, event: string, fields: Record<string, unknown> = {}): void {
  diagnosticLog.write(level, 'browser', event, fields);
}

process.on('uncaughtExceptionMonitor', (error, origin) => log('error', 'uncaught_exception', {
  origin, message: error.message, stack: error.stack ?? null,
}));
process.on('unhandledRejection', (reason) => log('error', 'unhandled_rejection', {
  message: reason instanceof Error ? reason.message : String(reason),
  stack: reason instanceof Error ? reason.stack ?? null : null,
}));
if (config.diagnosticsPath) {
  log('info', 'diagnostics_file_enabled', { path: config.diagnosticsPath });
}

const loaded = await loadWorld(config.worldDirectory);
const gamePersistence = new GamePersistence(config.gameDataPath);
let persisted: PersistedGame | null;
try {
  persisted = await gamePersistence.load();
} catch (error) {
  // load() parses the embedded GameState too (parseGameState), so a schema
  // version bump (e.g. the GAME_STATE_VERSION reset) throws here rather than
  // returning — the archive-and-retry safety net a few lines down only
  // covers a save that loaded but failed runtime reconstruction. Without
  // this, an old on-disk save crashes the server on every boot instead of
  // being archived once and replaced by a fresh world.
  const archivePath = await gamePersistence.archiveExisting();
  log('warn', 'incompatible_save_archived', {
    archivePath, reason: error instanceof Error ? error.message : String(error),
  });
  persisted = null;
}
const currentWorld = persisted?.gameVersion === GAME_VERSION && persisted.worldHash === loaded.hash;
const migratableV2World = persisted?.gameVersion === 'world-at-war@2' && persisted.worldHash === loaded.legacyHash;
if (persisted && (
  persisted.formatVersion !== 2 || persisted.runtime?.version !== 2
  || persisted.gameId !== GAME_ID || !currentWorld && !migratableV2World
)) {
  const archivePath = await gamePersistence.archiveExisting();
  log('warn', 'incompatible_save_archived', { archivePath, previousGameId: persisted.gameId });
  persisted = null;
}
function buildRuntime(snapshot: PersistedGame['runtime'] | undefined): GameRuntime {
  return new GameRuntime(loaded.world, snapshot);
}

let runtime: GameRuntime;
try {
  runtime = buildRuntime(persisted?.runtime);
} catch (error) {
  if (!persisted) throw error;
  // The outer worldHash/gameVersion check above only guards the raw geography
  // artifacts; it can't catch drift in the game-logic that derives the
  // movement graph or resource-node placement from them (e.g. a graph node
  // count that shifted since this save was created). Treat any restore
  // failure as an incompatible save rather than crashing the server.
  const archivePath = await gamePersistence.archiveExisting();
  log('warn', 'incompatible_save_archived', {
    archivePath, previousGameId: persisted.gameId,
    reason: error instanceof Error ? error.message : String(error),
  });
  persisted = null;
  runtime = buildRuntime(undefined);
}
let offlineCatchupHours = 0;
if (persisted) {
  offlineCatchupHours = offlineSimulationHours(persisted.savedAtEpochMs);
  if (offlineCatchupHours > 0) {
    runtime.tick(offlineCatchupHours);
    runtime.session.pendingCompletions.length = 0;
    runtime.session.pendingBuildings.length = 0;
    runtime.session.pendingCaptures.length = 0;
    runtime.session.pendingCombat.length = 0;
    log('info', 'offline_simulation_caught_up', { offlineHours: offlineCatchupHours });
  }
}
const gameClock = new AuthoritativeGameClock(() => runtime.session.state);
const scheduler = new SimulationScheduler((hours) => runtime.tick(hours));
runtime.updateWeather();

function persistedGame(): PersistedGame {
  return {
    formatVersion: 2,
    gameId: GAME_ID,
    gameVersion: GAME_VERSION,
    worldHash: loaded.hash,
    savedAtEpochMs: Date.now(),
    gameStartedAtEpochMs: gameClock.gameStartedAtEpochMs,
    runtime: runtime.snapshot(),
  };
}

async function saveGame(): Promise<void> { await gamePersistence.save(persistedGame()); }
function saveGameInBackground(): void {
  void saveGame().catch((error) => log('error', 'game_save_failed', {
    message: error instanceof Error ? error.message : String(error),
  }));
}
if (!persisted || offlineCatchupHours > 0) await saveGame();

const server = createInternalApiServer({
  runtime,
  internalSecret: config.internalSecret,
  revision: () => publisher.revision,
  afterJoin: saveGame,
  log,
});
// devSimSpeed is 1 in production; a local tester can set IRONFRONTS_DEV_SIM_SPEED
// (startup default) or the in-session debug-panel control to fast-forward the
// simulation (movement/production/combat) without touching any balance
// constant. The multiplier is a single live value shared by the whole server
// process — every connected player sees the same pace, which is expected for
// a one-tester dev/QA lever, not a per-player setting.
const devControlsEnabled = config.debugControlsEnabled;
let simSpeedMultiplier = config.devSimSpeed;
if (simSpeedMultiplier !== 1) log('warn', 'dev_sim_speed_active', { multiplier: simSpeedMultiplier });
/** Clamped to 1–10000x. No-op outside dev, no matter who calls it. */
function setDevSimSpeed(multiplier: number): void {
  if (!devControlsEnabled) return;
  simSpeedMultiplier = clampSimSpeed(multiplier);
  log('info', 'dev_sim_speed_changed', { multiplier: simSpeedMultiplier });
}

let lastPumpSteps = 0;
let lastPumpMilliseconds = 0;
let effectiveSpeed = 1;
let previousPumpAt = performance.now();
function pumpSimulation(): void {
  const started = performance.now();
  const realElapsedSeconds = Math.max(0, started - previousPumpAt) / 1_000;
  const gameBefore = runtime.session.gameTimeHours;
  lastPumpSteps = scheduler.pump(simSpeedMultiplier);
  const finished = performance.now();
  lastPumpMilliseconds = finished - started;
  previousPumpAt = started;
  if (realElapsedSeconds >= 0.01) {
    const measured = (runtime.session.gameTimeHours - gameBefore) * 3_600 / realElapsedSeconds;
    effectiveSpeed = effectiveSpeed * 0.8 + measured * 0.2;
  }
}

const gateway: GameplayGateway = new GameplayGateway({
  server,
  runtime,
  clientOrigin: config.clientOrigin,
  ticketSecret: config.ticketSecret,
  debugControlsEnabled: config.debugControlsEnabled,
  world: { version: loaded.version, hash: loaded.hash, artifactHashes: loaded.artifactHashes, assetBaseUrl: config.worldPublicUrl },
  clock: gameClock,
  revision: () => publisher.revision,
  saveGameInBackground,
  publishNow: publishProjection,
  beforeDebugChange: pumpSimulation,
  devSimSpeed: { get: () => simSpeedMultiplier, set: setDevSimSpeed, enabled: devControlsEnabled },
  devDiagnostics: { get: () => ({
    requestedSpeed: simSpeedMultiplier, effectiveSpeed: Math.max(0, effectiveSpeed),
    pendingSimulationSeconds: scheduler.pendingSeconds, lastPumpSteps, lastPumpMilliseconds,
    overloaded: scheduler.pendingSeconds > 1,
  }) },
  log,
  clientLog: config.diagnosticsPath ? clientLog : undefined,
});

const publisher: ProjectionPublisher = new ProjectionPublisher(runtime, () => gateway.connections,
  (connection, message) => gateway.send(connection, message), () => simSpeedMultiplier);
let lastPublishMilliseconds = 0;
let maximumPublishMilliseconds = 0;
function publishProjection(): void {
  const started = performance.now();
  publisher.publish();
  lastPublishMilliseconds = performance.now() - started;
  maximumPublishMilliseconds = Math.max(maximumPublishMilliseconds, lastPublishMilliseconds);
  if (lastPublishMilliseconds >= 250) log('warn', 'slow_projection_publish', {
    milliseconds: lastPublishMilliseconds, revision: publisher.revision,
    connections: gateway.connections.size,
  });
}
const simulationTimer = setInterval(
  pumpSimulation,
  SIMULATION_INTERVAL_MS,
);
const persistenceTimer = setInterval(saveGameInBackground, 5_000);
// Visual world time is independent of simulation time. Sparse samples correct
// client interpolation drift and preserve manual/timezone-linked settings.
const clockSyncTimer = setInterval(() => {
  const clock = gameClock.snapshot();
  gateway.broadcast({ type: 'clockSync', clock });
}, CLOCK_SYNC_INTERVAL_MS);
const publishTimer = setInterval(publishProjection, 250);
const weatherTimer = setInterval(() => {
  if (!runtime.updateWeather()) return;
  publishProjection();
  saveGameInBackground();
}, 60_000);
const debugDiagnosticsTimer = setInterval(() => gateway.broadcastDebugState(), 1_000);
let previousHealthAt = performance.now();
const healthTimer = setInterval(() => {
  const now = performance.now();
  const intervalMilliseconds = now - previousHealthAt;
  previousHealthAt = now;
  const memory = process.memoryUsage();
  log(intervalMilliseconds >= 7_500 || lastPumpMilliseconds >= 250 ? 'warn' : 'info', 'server_health', {
    eventLoopDelayMilliseconds: Math.max(0, intervalMilliseconds - 5_000),
    simulationSpeed: simSpeedMultiplier,
    effectiveSpeed,
    pendingSimulationSeconds: scheduler.pendingSeconds,
    lastPumpSteps,
    lastPumpMilliseconds,
    lastPublishMilliseconds,
    maximumPublishMilliseconds,
    revision: publisher.revision,
    connections: gateway.connections.size,
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
  });
  maximumPublishMilliseconds = 0;
}, 5_000);

server.listen(config.port, '127.0.0.1', () => log('info', 'listening', { port: config.port, gameId: GAME_ID }));

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log('info', 'shutdown', { signal });
  clearInterval(simulationTimer);
  clearInterval(persistenceTimer);
  clearInterval(clockSyncTimer);
  clearInterval(publishTimer);
  clearInterval(weatherTimer);
  clearInterval(debugDiagnosticsTimer);
  clearInterval(healthTimer);
  gateway.closeAll();
  void saveGame().then(() => gamePersistence.flush()).then(() => diagnosticLog.flush()).then(() => {
    server.close(() => process.exit(0));
  }).catch((error) => {
    log('error', 'final_game_save_failed', { message: error instanceof Error ? error.message : String(error) });
    server.close(() => process.exit(1));
  });
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
