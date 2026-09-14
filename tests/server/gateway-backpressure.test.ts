import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { GameplayGateway } from '../../apps/game-server/src/gameplay-gateway';
import type { GameplayConnection } from '../../apps/game-server/src/gameplay-gateway';

describe('gameplay gateway backpressure', () => {
  it('closes an overloaded socket and reports that the message was not delivered', () => {
    const server = createServer();
    const gateway = new GameplayGateway({
      server, runtime: {} as never, clientOrigin: 'http://client', ticketSecret: 'x'.repeat(32),
      debugControlsEnabled: false, debugPassword: '',
      world: { version: '1', hash: 'a'.repeat(64), assetBaseUrl: 'http://world', artifactHashes: {} },
      clock: {} as never, revision: () => 0, publishNow: vi.fn(), beforeDebugChange: vi.fn(),
      saveGameInBackground: vi.fn(), devSimSpeed: { get: () => 1, set: vi.fn(), enabled: false }, log: vi.fn(),
      devDiagnostics: { get: () => ({ requestedSpeed: 1, effectiveSpeed: 1, pendingSimulationSeconds: 0,
        lastPumpSteps: 1, lastPumpMilliseconds: 0, overloaded: false }) },
    });
    const socket = { readyState: WebSocket.OPEN, bufferedAmount: 2_000_001, close: vi.fn(), send: vi.fn() };
    const connection = { socket, accountId: 'a', countryId: 1, debugEntitled: false, debugEnabled: false, projection: {} as never, revision: 0 } as unknown as GameplayConnection;
    expect(gateway.send(connection, { type: 'error', code: 'test', message: 'test' })).toBe(false);
    expect(socket.close).toHaveBeenCalledWith(1013, 'Resynchronize slow connection');
    expect(socket.send).not.toHaveBeenCalled();
    gateway.closeAll();
    server.close();
  });
});
