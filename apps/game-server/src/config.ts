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

export const config = {
  port: numberEnv('GAME_PORT', 3002),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://127.0.0.1:5173',
  /** Browser-visible URL of the map package. This belongs to the client/CDN,
   * not the game server; each future game version can declare another URL. */
  worldPublicUrl: (process.env.WORLD_PUBLIC_URL
    ?? `${process.env.CLIENT_ORIGIN ?? 'http://127.0.0.1:5173'}/world`).replace(/\/$/, ''),
  worldDirectory: path.resolve(process.cwd(), process.env.WORLD_DIRECTORY ?? 'public/world'),
  gameDataPath: path.resolve(
    process.cwd(),
    process.env.GAME_DATA_PATH ?? path.join(process.env.DATA_DIRECTORY ?? 'data', 'game.json'),
  ),
  diagnosticsPath: path.resolve(
    process.cwd(),
    process.env.DIAGNOSTICS_PATH ?? path.join(process.env.DATA_DIRECTORY ?? 'data', 'diagnostics.jsonl'),
  ),
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
