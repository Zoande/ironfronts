/** Service-to-service game lobby/join HTTP API. */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { GameRuntime } from './runtime';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > 32_768) throw new Error('Request body is too large.');
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify(value));
}

export interface InternalApiOptions {
  readonly runtime: GameRuntime;
  readonly internalSecret: string;
  readonly revision: () => number;
  readonly afterJoin: () => Promise<void>;
  readonly log: (
    level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, unknown>,
  ) => void;
}

export function createInternalApiServer(options: InternalApiOptions) {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      if (url.pathname === '/health') {
        sendJson(response, 200, {
          ok: true, service: 'game-server', gameId: options.runtime.lobby().gameId,
          revision: options.revision(),
        });
        return;
      }
      if (!url.pathname.startsWith('/internal/v2/')) {
        sendJson(response, 404, { error: 'Not found.' });
        return;
      }
      if (request.headers.authorization !== `Bearer ${options.internalSecret}`) {
        sendJson(response, 401, { error: 'Invalid service credentials.' });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/internal/v2/lobby') {
        sendJson(
          response, 200,
          options.runtime.lobby(url.searchParams.get('accountId') ?? undefined),
        );
        return;
      }
      if (request.method === 'POST' && url.pathname === '/internal/v2/join') {
        const input = await body(request);
        if (typeof input.accountId !== 'string' || !Number.isInteger(input.countryId)) {
          sendJson(response, 400, { error: 'accountId and countryId are required.' });
          return;
        }
        const result = options.runtime.join(input.accountId, Number(input.countryId));
        if (result.ok) await options.afterJoin();
        sendJson(response, result.ok ? 200 : 409, result);
        if (result.ok) options.log('info', 'country_claimed', { countryId: result.countryId });
        return;
      }
      sendJson(response, 404, { error: 'Not found.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected server error.';
      sendJson(response, 500, { error: message });
    }
  });
}
