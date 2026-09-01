import {
  GAME_ID, GAME_VERSION, type PlayerProjection,
} from '@ironfronts/protocol';
import { config } from './config';
import { loadWorld } from './world-loader';
import { GameRuntime } from './runtime';
import { diffProjection } from './projection';
import { AuthoritativeGameClock } from './game-clock';
import {
  CLOCK_SYNC_INTERVAL_MS, SIMULATION_INTERVAL_MS, SIMULATION_TICK_HOURS, clampSimSpeed,
} from './timing';
import { GamePersistence, type PersistedGame } from './persistence';
import { createInternalApiServer } from './internal-api';
import { collectPendingEvents, eventsForCountry } from './event-feed';
import { GameplayGateway } from './gameplay-gateway';

function log(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, service: 'game-server', event, ...fields }));
}

const loaded = await loadWorld(config.worldDirectory);
const gamePersistence = new GamePersistence(config.gameDataPath);
let persisted = await gamePersistence.load();
if (persisted && (
  persisted.formatVersion !== 2 || persisted.runtime?.version !== 2
  || persisted.gameId !== GAME_ID || persisted.gameVersion !== GAME_VERSION
  || persisted.worldHash !== loaded.hash
)) {
  const archivePath = await gamePersistence.archiveExisting();
  log('warn', 'incompatible_save_archived', { archivePath, previousGameId: persisted.gameId });
  persisted = null;
}
const runtime = new GameRuntime(loaded.world, persisted?.runtime);
const gameClock = new AuthoritativeGameClock(persisted?.gameStartedAtEpochMs);
let revision = 0;

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
if (!persisted) await saveGame();

const server = createInternalApiServer({
  runtime,
  internalSecret: config.internalSecret,
  revision: () => revision,
  afterJoin: saveGame,
  log,
});
// devSimSpeed is 1 in production; a local tester can set IRONFRONTS_DEV_SIM_SPEED
// (startup default) or the in-session debug-panel control to fast-forward the
// simulation (movement/production/combat) without touching any balance
// constant. The multiplier is a single live value shared by the whole server
// process — every connected player sees the same pace, which is expected for
// a one-tester dev/QA lever, not a per-player setting.
const devControlsEnabled = process.env.NODE_ENV !== 'production';
let simSpeedMultiplier = config.devSimSpeed;
if (simSpeedMultiplier !== 1) log('warn', 'dev_sim_speed_active', { multiplier: simSpeedMultiplier });
/** Clamped (see clampSimSpeed; 0 = paused). No-op outside dev, no matter who calls it. */
function setDevSimSpeed(multiplier: number): void {
  if (!devControlsEnabled) return;
  simSpeedMultiplier = clampSimSpeed(multiplier);
  log('info', 'dev_sim_speed_changed', { multiplier: simSpeedMultiplier });
}

const gateway = new GameplayGateway({
  server,
  runtime,
  clientOrigin: config.clientOrigin,
  ticketSecret: config.ticketSecret,
  world: { version: loaded.version, hash: loaded.hash, assetBaseUrl: config.worldPublicUrl },
  clock: gameClock,
  revision: () => revision,
  saveGameInBackground,
  devSimSpeed: { get: () => simSpeedMultiplier, set: setDevSimSpeed, enabled: devControlsEnabled },
  log,
});

const simulationTimer = setInterval(
  () => runtime.tick(SIMULATION_TICK_HOURS * simSpeedMultiplier),
  SIMULATION_INTERVAL_MS,
);
const persistenceTimer = setInterval(saveGameInBackground, 5_000);
// Civil time is interpolated by clients. This sparse sample corrects drift;
// it is intentionally independent of the 10 Hz authoritative simulation.
const clockSyncTimer = setInterval(() => {
  const clock = gameClock.snapshot();
  gateway.broadcast({ type: 'clockSync', clock });
}, CLOCK_SYNC_INTERVAL_MS);
const publishTimer = setInterval(() => {
  const pendingEvents = collectPendingEvents(runtime, revision);
  if (!gateway.connections.size) return;
  const byCountry = new Map<number, PlayerProjection>();
  for (const connection of gateway.connections) {
    if (!byCountry.has(connection.countryId)) byCountry.set(connection.countryId, runtime.projection(connection.countryId));
  }
  const changes = [...gateway.connections].map((connection) => ({
    connection,
    next: byCountry.get(connection.countryId)!,
    delta: diffProjection(connection.projection, byCountry.get(connection.countryId)!),
  }));
  if (!changes.some((entry) => entry.delta)) return;
  revision += 1;
  for (const { connection, next, delta } of changes) {
    const events = eventsForCountry(pendingEvents, connection.countryId, revision);
    if (delta) gateway.send(connection, {
      type: 'delta', fromRevision: connection.revision, revision, delta, events,
    });
    connection.projection = next;
    connection.revision = revision;
  }
}, 250);

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
  gateway.closeAll();
  void saveGame().then(() => gamePersistence.flush()).then(() => {
    server.close(() => process.exit(0));
  }).catch((error) => {
    log('error', 'final_game_save_failed', { message: error instanceof Error ? error.message : String(error) });
    server.close(() => process.exit(1));
  });
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
