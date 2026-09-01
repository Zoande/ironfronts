import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { credentialsSchema, GAME_ID, joinGameSchema, PROTOCOL_VERSION, type GameLobby, type SessionResponse } from '@ironfronts/protocol';
import { signGameTicket } from '@ironfronts/protocol/ticket';
import { config } from './config';
import { AuthStore, type Account } from './auth-store';
import { RateLimiter } from './rate-limit';

await mkdir(path.dirname(config.authDatabasePath), { recursive: true });
const store = new AuthStore(config.authDatabasePath);
const limiter = new RateLimiter();
const SESSION_COOKIE = 'ironfronts_session';

function log(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, service: 'auth-server', event, ...fields }));
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': config.clientOrigin,
    'access-control-allow-credentials': 'true',
    'vary': 'Origin',
  };
}

function sendJson(response: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders(), ...headers });
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
}

function cookies(request: IncomingMessage): Record<string, string> {
  return Object.fromEntries((request.headers.cookie ?? '').split(';').flatMap((part) => {
    const index = part.indexOf('=');
    return index < 0 ? [] : [[part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))]];
  }));
}

function cookie(token: string, maxAgeSeconds: number): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${config.production ? '; Secure' : ''}`;
}

function requireOrigin(request: IncomingMessage): boolean {
  return request.method === 'GET' || request.method === 'HEAD' || request.headers.origin === config.clientOrigin;
}

function remoteKey(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? 'unknown';
}

async function gameRequest<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${config.gameInternalUrl}${pathname}`, {
    ...init,
    signal: AbortSignal.timeout(5_000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.internalSecret}`, ...init?.headers },
  });
  const value = await response.json() as T & { reason?: string; error?: string };
  if (!response.ok) throw new Error(value.reason ?? value.error ?? 'Game server rejected the request.');
  return value;
}

async function assignment(accountId: string): Promise<{ gameId: string; countryId: number } | null> {
  const lobby = await gameRequest<GameLobby>(`/internal/v2/lobby?accountId=${encodeURIComponent(accountId)}`);
  return lobby.assignedCountryId === null ? null : { gameId: lobby.gameId, countryId: lobby.assignedCountryId };
}

async function sessionResponse(account: Account | null): Promise<SessionResponse> {
  if (!account) return { authenticated: false };
  return {
    authenticated: true,
    account: { id: account.id, username: account.username },
    assignment: await assignment(account.id),
    profile: store.commanderProfile(account.id),
  };
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'OPTIONS') {
      if (request.headers.origin !== config.clientOrigin) { sendJson(response, 403, { error: 'Origin not allowed.' }); return; }
      response.writeHead(204, { ...corsHeaders(), 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' });
      response.end();
      return;
    }
    if (!requireOrigin(request)) { sendJson(response, 403, { error: 'Origin not allowed.' }); return; }
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (url.pathname === '/health') { sendJson(response, 200, { ok: true, service: 'auth-server' }); return; }
    const sessionToken = cookies(request)[SESSION_COOKIE];
    const account = store.sessionAccount(sessionToken);

    if (request.method === 'POST' && (url.pathname === '/v1/auth/register' || url.pathname === '/v1/auth/login')) {
      if (!limiter.consume(`${remoteKey(request)}:${url.pathname}`)) { sendJson(response, 429, { error: 'Too many attempts. Try again later.' }); return; }
      const input = credentialsSchema.parse(await body(request));
      let authenticated: Account | null;
      if (url.pathname.endsWith('/register')) authenticated = await store.register(input.username, input.password);
      else authenticated = await store.authenticate(input.username, input.password);
      if (!authenticated) { sendJson(response, 401, { error: 'Invalid username or password.' }); return; }
      const created = store.createSession(authenticated.id, config.sessionTtlMs);
      sendJson(response, url.pathname.endsWith('/register') ? 201 : 200, await sessionResponse(authenticated), {
        'set-cookie': cookie(created.token, Math.floor(config.sessionTtlMs / 1_000)),
      });
      log('info', url.pathname.endsWith('/register') ? 'registered' : 'logged_in', { accountId: authenticated.id });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/auth/logout') {
      store.revoke(sessionToken);
      sendJson(response, 200, { ok: true }, { 'set-cookie': cookie('', 0) });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v1/auth/session') {
      sendJson(response, 200, await sessionResponse(account));
      return;
    }
    if (!account) { sendJson(response, 401, { error: 'Authentication required.' }); return; }
    if (request.method === 'GET' && url.pathname === '/v1/profile') {
      sendJson(response, 200, store.commanderProfile(account.id));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/v2/game') {
      sendJson(response, 200, await gameRequest<GameLobby>(`/internal/v2/lobby?accountId=${encodeURIComponent(account.id)}`));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v2/game/join') {
      const input = joinGameSchema.parse(await body(request));
      const joined = await gameRequest<{ ok: true; countryId: number }>('/internal/v2/join', {
        method: 'POST', body: JSON.stringify({ accountId: account.id, countryId: input.countryId }),
      });
      sendJson(response, 200, { assignment: { gameId: GAME_ID, countryId: joined.countryId } });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v2/game/connect') {
      const assigned = await assignment(account.id);
      if (!assigned) { sendJson(response, 409, { error: 'Choose a country before connecting.' }); return; }
      const ticket = signGameTicket({
        accountId: account.id, gameId: assigned.gameId, countryId: assigned.countryId,
        audience: 'game-server', protocolVersion: PROTOCOL_VERSION,
        expiresAt: Date.now() + 30_000, nonce: randomUUID(),
      }, config.ticketSecret);
      sendJson(response, 200, { ticket, websocketUrl: config.gamePublicWsUrl, protocolVersion: PROTOCOL_VERSION });
      return;
    }
    sendJson(response, 404, { error: 'Not found.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error.';
    const conflict = /already|permanently|claimed/i.test(message);
    sendJson(response, conflict ? 409 : 400, { error: message });
    log('warn', 'request_failed', { path: request.url, message });
  }
});

const cleanupTimer = setInterval(() => { store.cleanup(); limiter.cleanup(); }, 60_000);
server.listen(config.port, '127.0.0.1', () => log('info', 'listening', { port: config.port }));

function shutdown(signal: string): void {
  log('info', 'shutdown', { signal });
  clearInterval(cleanupTimer);
  server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
