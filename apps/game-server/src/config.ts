import path from 'node:path';

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number.`);
  return value;
}

function secret(name: string, fallback: string): string {
  const value = process.env[name] ?? fallback;
  if (process.env.NODE_ENV === 'production' && value === fallback) throw new Error(`${name} is required in production.`);
  return value;
}

const debugControlsEnabled = process.env.IRONFRONTS_DEBUG_CONTROLS_ENABLED === 'true';
const diagnosticsPath = process.env.DIAGNOSTICS_PATH?.trim();
const europe = process.env.MAP_KIND === 'europe';

export const config = {
  port: numberEnv('GAME_PORT', europe ? 3003 : 3002),
  gameId: europe ? 'europe-at-war-1' : 'world-at-war-2',
  gameVersion: europe ? 'europe-at-war@1' : 'world-at-war@4',
  gameName: europe ? 'Europe at War' : 'World at War',
  scenarioId: europe ? 'OP-EUROPE-01' : 'OP-1939-01',
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://127.0.0.1:5173',
  /** Browser-visible URL of the map package. This belongs to the client/CDN,
   * not the game server; each future game version can declare another URL. */
  worldPublicUrl: (process.env.WORLD_PUBLIC_URL
    ?? `${process.env.CLIENT_ORIGIN ?? 'http://127.0.0.1:5173'}/${europe ? 'europe' : 'world'}`).replace(/\/$/, ''),
  worldDirectory: path.resolve(process.cwd(), process.env.WORLD_DIRECTORY ?? `public/${europe ? 'europe' : 'world'}`),
  gameDataPath: path.resolve(
    process.cwd(),
    process.env.GAME_DATA_PATH ?? path.join(process.env.DATA_DIRECTORY ?? 'data', europe ? 'game-europe.json' : 'game.json'),
  ),
  /** JSONL diagnostics are opt-in. Unset or blank means no diagnostic file. */
  diagnosticsPath: diagnosticsPath ? path.resolve(process.cwd(), diagnosticsPath) : undefined,
  ticketSecret: secret('TICKET_SECRET', 'ironfronts-local-ticket-secret-change-me'),
  internalSecret: secret('INTERNAL_SERVICE_SECRET', 'ironfronts-local-service-secret-change-me'),
  /** Explicit deployment gate layered on top of the signed account claim. */
  debugControlsEnabled,
  /**
   * DEV / TESTING ONLY. Multiplies simulation time (movement, production,
   * combat, clock all scale together — it just advances game-time faster).
   * Deterministic; touches no balance constant. Ignored in production and
   * clamped to [1, 10000]. Set IRONFRONTS_DEV_SIM_SPEED=100 to fast-forward.
   */
  devSimSpeed: !debugControlsEnabled
    ? 1
    : Math.max(1, Math.min(10_000, Number(process.env.IRONFRONTS_DEV_SIM_SPEED ?? 1) || 1)),
} as const;
