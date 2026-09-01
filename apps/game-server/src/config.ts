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
  ticketSecret: secret('TICKET_SECRET', 'ironfronts-local-ticket-secret-change-me'),
  internalSecret: secret('INTERNAL_SERVICE_SECRET', 'ironfronts-local-service-secret-change-me'),
  /**
   * DEV / TESTING ONLY. Multiplies simulation time (movement, production,
   * combat, clock all scale together — it just advances game-time faster).
   * Deterministic; touches no balance constant. Ignored in production and
   * clamped to [0.25, 8]. Set IRONFRONTS_DEV_SIM_SPEED=4 to fast-forward.
   */
  devSimSpeed: process.env.NODE_ENV === 'production'
    ? 1
    : Math.max(0.25, Math.min(8, Number(process.env.IRONFRONTS_DEV_SIM_SPEED ?? 1) || 1)),
} as const;
