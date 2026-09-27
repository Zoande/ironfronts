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
  port: numberEnv('AUTH_PORT', 3001),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://127.0.0.1:5173',
  gameInternalUrl: process.env.GAME_INTERNAL_URL ?? 'http://127.0.0.1:3002',
  gamePublicWsUrl: process.env.GAME_PUBLIC_WS_URL ?? 'ws://127.0.0.1:3002/v2/game',
  europeInternalUrl: process.env.EUROPE_INTERNAL_URL ?? 'http://127.0.0.1:3003',
  europePublicWsUrl: process.env.EUROPE_PUBLIC_WS_URL ?? 'ws://127.0.0.1:3003/v2/game',
  sessionTtlMs: numberEnv('SESSION_TTL_SECONDS', 86_400) * 1_000,
  authDatabasePath: path.resolve(
    process.cwd(),
    process.env.AUTH_DATABASE_PATH ?? path.join(process.env.DATA_DIRECTORY ?? 'data', 'auth.sqlite'),
  ),
  ticketSecret: secret('TICKET_SECRET', 'ironfronts-local-ticket-secret-change-me'),
  internalSecret: secret('INTERNAL_SERVICE_SECRET', 'ironfronts-local-service-secret-change-me'),
  production: process.env.NODE_ENV === 'production',
} as const;
