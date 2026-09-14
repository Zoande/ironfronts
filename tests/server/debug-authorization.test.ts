import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { GAME_ID, PROTOCOL_VERSION } from '../../packages/protocol/src/index';
import { signGameTicket } from '../../packages/protocol/src/ticket';
import { GameplayGateway } from '../../apps/game-server/src/gameplay-gateway';
import { isDebugEntitledUsername } from '../../apps/auth-server/src/debug-entitlement';

const secret = 'a sufficiently long debug authorization secret';
const debugPassword = 'correct horse battery staple';
const openGateways: Array<{ gateway: GameplayGateway; server: ReturnType<typeof createServer> }> = [];

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.OPEN;
  bufferedAmount = 0;
  readonly sent: Array<Record<string, unknown>> = [];
  readonly close = vi.fn((code?: number, reason?: string) => {
    this.readyState = WebSocket.CLOSED; this.emit('close', code, Buffer.from(reason ?? ''));
  });
  send(text: string): void { this.sent.push(JSON.parse(text) as Record<string, unknown>); }
  message(value: unknown): void { this.emit('message', Buffer.from(JSON.stringify(value))); }
}

function projection() {
  return { simulationTick: 0, viewerCountryId: 7, startCamera: { x: 0, z: 0, distance: 1 },
    countries: {}, provinceOwners: {}, provinceBuildings: {}, provinceActions: {}, productionQueues: {},
    constructionQueues: {}, rallyPoints: {}, armies: {}, resourceNodes: {}, ownCountry: null, relations: {} } as never;
}

function setup(deploymentEnabled = true) {
  const server = createServer();
  const setSpeed = vi.fn();
  const runtime = { seat: () => 7, projection, catalogs: { units: [], buildings: [] }, command: vi.fn(),
    setWeatherMode: vi.fn(), cheatBuild: vi.fn(() => ({ ok: true, message: 'built' })),
    cheatSpawnUnit: vi.fn(() => ({ ok: true, message: 'spawned' })),
    cheatGiveResource: vi.fn(() => ({ ok: true, message: 'granted' })) };
  const gateway = new GameplayGateway({ server, runtime: runtime as never,
    clientOrigin: 'http://client', ticketSecret: secret,
    world: { version: '1', hash: 'a'.repeat(64), assetBaseUrl: 'http://world', artifactHashes: {} },
    clock: { snapshot: () => ({ gameStartedAtEpochMs: 0, gameEpochMs: 0, serverEpochMs: 0, speed: 1, generation: 0, utcOffsetMinutes: 0 }),
      setEpoch: vi.fn(), linkTimezone: vi.fn() } as never,
    revision: () => 0, publishNow: vi.fn(), beforeDebugChange: vi.fn(), saveGameInBackground: vi.fn(),
    debugControlsEnabled: deploymentEnabled, debugPassword,
    devSimSpeed: { get: () => 1, set: setSpeed, enabled: deploymentEnabled },
    devDiagnostics: { get: () => ({ requestedSpeed: 1, effectiveSpeed: 1, pendingSimulationSeconds: 0,
      lastPumpSteps: 1, lastPumpMilliseconds: 0, overloaded: false }) }, log: vi.fn() });
  openGateways.push({ gateway, server });
  const connect = (nonce: string, debugEntitled = false) => {
    const socket = new FakeSocket();
    (gateway as unknown as { handleConnection(socket: WebSocket): void }).handleConnection(socket as unknown as WebSocket);
    socket.message({ type: 'authenticate', protocolVersion: PROTOCOL_VERSION,
      ticket: signGameTicket({ accountId: `account-${nonce}`, debugEntitled, gameId: GAME_ID, countryId: 7,
        audience: 'game-server', protocolVersion: PROTOCOL_VERSION,
        expiresAt: Date.now() + 30_000, nonce }, secret) });
    return socket;
  };
  return { gateway, runtime, setSpeed, connect };
}

afterEach(() => { for (const { gateway, server } of openGateways.splice(0)) { gateway.closeAll(); server.close(); } });

describe('account + password gated debug authorization', () => {
  it('entitles only DimaTest1, case-insensitively', () => {
    expect(isDebugEntitledUsername('DimaTest1')).toBe(true);
    expect(isDebugEntitledUsername('dImAtEsT1')).toBe(true);
    expect(isDebugEntitledUsername('ordinary')).toBe(false);
  });

  it('disables debug when the deployment gate is off even for an entitled account', () => {
    const socket = setup(false).connect('disabled', true);
    expect(socket.sent.find((message) => message.type === 'hello')).toMatchObject({
      debugEnabled: false, debugUnlockAvailable: false,
    });
    socket.close();
  });

  it('does not expose an unlock path to an ordinary authenticated account', () => {
    const socket = setup(true).connect('ordinary', false);
    expect(socket.sent.find((message) => message.type === 'hello')).toMatchObject({
      debugEnabled: false, debugUnlockAvailable: false,
    });
    socket.message({ type: 'devUnlockDebug', password: debugPassword });
    expect(socket.sent.at(-1)).toMatchObject({ type: 'error', code: 'unauthorized_debug' });
    socket.close();
  });

  it('requires the password before an entitled account can use debug controls', () => {
    const { connect, setSpeed } = setup(true);
    const socket = connect('dima', true);
    expect(socket.sent.find((message) => message.type === 'hello')).toMatchObject({
      debugEnabled: false, debugUnlockAvailable: true,
    });

    socket.message({ type: 'devSetSimSpeed', multiplier: 4 });
    expect(socket.sent.at(-1)).toMatchObject({ type: 'error', code: 'unauthorized_debug' });
    expect(setSpeed).not.toHaveBeenCalled();

    socket.message({ type: 'devUnlockDebug', password: 'wrong password' });
    expect(socket.sent.at(-1)).toMatchObject({ type: 'devDebugAccess', enabled: false });

    socket.message({ type: 'devUnlockDebug', password: debugPassword });
    expect(socket.sent.some((message) => message.type === 'devDebugAccess' && message.enabled === true)).toBe(true);
    expect(socket.sent.some((message) => message.type === 'devDiagnostics' && message.devControlsEnabled === true)).toBe(true);

    socket.message({ type: 'devSetSimSpeed', multiplier: 4 });
    expect(setSpeed).toHaveBeenCalledWith(4);
    socket.close();
  });

  it('rejects debug unlock and operations before authentication', () => {
    const { gateway } = setup(); const socket = new FakeSocket();
    (gateway as unknown as { handleConnection(socket: WebSocket): void }).handleConnection(socket as unknown as WebSocket);
    socket.message({ type: 'devUnlockDebug', password: debugPassword });
    expect(socket.sent.at(-1)).toMatchObject({ type: 'error', code: 'authentication_required' });
    socket.message({ type: 'devSetSimSpeed', multiplier: 4 });
    expect(socket.sent.at(-1)).toMatchObject({ type: 'error', code: 'authentication_required' });
    socket.close();
  });
});
