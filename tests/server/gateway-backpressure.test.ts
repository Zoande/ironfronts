import { createServer } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { GameplayGateway } from '../../apps/game-server/src/gameplay-gateway';
import type { GameplayConnection } from '../../apps/game-server/src/gameplay-gateway';

describe('gameplay gateway backpressure', () => {
  it('allows the observed initial baseline buffer and closes only sustained overload', () => {
    const server = createServer();
    const gateway = new GameplayGateway({
      server, runtime: {} as never, clientOrigin: 'http://client', ticketSecret: 'x'.repeat(32),
      debugControlsEnabled: false,
      world: { version: '1', hash: 'a'.repeat(64), assetBaseUrl: 'http://world', artifactHashes: {} },
      clock: {} as never, revision: () => 0, publishNow: vi.fn(), beforeDebugChange: vi.fn(),
      saveGameInBackground: vi.fn(), devSimSpeed: { get: () => 1, set: vi.fn(), enabled: false }, log: vi.fn(),
      devDiagnostics: { get: () => ({ requestedSpeed: 1, effectiveSpeed: 1, pendingSimulationSeconds: 0,
        lastPumpSteps: 1, lastPumpMilliseconds: 0, overloaded: false }) },
    });
    const socket = { readyState: WebSocket.OPEN, bufferedAmount: 3_182_858, close: vi.fn(), send: vi.fn() };
    const connection = { socket, accountId: 'a', countryId: 1, debugEnabled: false, projection: {} as never, revision: 0 } as unknown as GameplayConnection;
    expect(gateway.send(connection, { type: 'error', code: 'test', message: 'test' })).toBe(true);
    expect(socket.close).not.toHaveBeenCalled();

    const now = vi.spyOn(performance, 'now');
    socket.bufferedAmount = 8 * 1024 * 1024 + 1;
    now.mockReturnValueOnce(100).mockReturnValueOnce(10_101);
    expect(gateway.send(connection, { type: 'error', code: 'test', message: 'test' })).toBe(false);
    expect(socket.close).not.toHaveBeenCalled();
    expect(gateway.send(connection, { type: 'error', code: 'test', message: 'test' })).toBe(false);
    expect(socket.close).toHaveBeenCalledWith(1013, 'Resynchronize slow connection');
    expect(socket.send).toHaveBeenCalledTimes(1);
    now.mockRestore();
    gateway.closeAll();
    server.close();
  });
});
