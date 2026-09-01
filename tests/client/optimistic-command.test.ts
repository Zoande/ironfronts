import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlayerProjection, PresentationCatalogs } from '../../packages/protocol/src/index';
import { GameConnection } from '../../src/client/game-connection';
import { RemoteGameSession } from '../../src/client/remote-session';

function state(): PlayerProjection {
  return {
    simulationTick: 0, viewerCountryId: 1, startCamera: { x: 0, z: 0, distance: 900 },
    countries: { 1: { id: 1, name: 'A', color: '#fff', controller: 'player', alive: true } },
    provinceOwners: { 1: 1 }, provinceBuildings: {}, productionQueues: {}, constructionQueues: {},
    rallyPoints: {},
    armies: { a: { id: 'a', name: 'Army', ownerCountryId: 1, ownerName: 'A', ownerColor: '#fff', x: 0, z: 0, own: true, contact: 'visible', status: 'idle', composition: null, moveOrder: null } },
    resourceNodes: {}, ownCountry: { id: 1, name: 'A', color: '#fff', controller: 'player', stockpile: { funds: 100, manpower: 100, food: 100, stone: 100, metal: 100, oil: 100 }, income: { funds: 0, manpower: 0, food: 0, stone: 0, metal: 0, oil: 0 }, industryCapacity: 1 }, relations: {},
  };
}

class FakeConnection extends EventTarget {
  state = state();
  catalogs: PresentationCatalogs = { units: [], buildings: [] };
  commands: unknown[] = [];
  settle: ((ok: boolean, reason?: string, requiredWarCountryIds?: readonly number[]) => void) | null = null;
  command(command: unknown, callback: (ok: boolean, reason?: string, requiredWarCountryIds?: readonly number[]) => void): string {
    this.commands.push(command);
    this.settle = callback;
    return `command-${this.commands.length}`;
  }
}

afterEach(() => vi.useRealTimers());

describe('optimistic command lifecycle', () => {
  it('shows an order immediately, keeps it through ack, then reconciles on a delta', () => {
    const connection = new FakeConnection();
    const session = new RemoteGameSession(connection as unknown as GameConnection, vi.fn());
    session.orderMove('a', 50, 70);
    expect(session.army('a')?.moveOrder).toEqual({ x: 50, z: 70 });
    connection.settle?.(true);
    expect(session.army('a')?.moveOrder).toEqual({ x: 50, z: 70 });
    connection.state.armies.a.moveOrder = { x: 50, z: 70 };
    connection.dispatchEvent(new Event('state'));
    expect(session.army('a')?.moveOrder).toEqual({ x: 50, z: 70 });
  });

  it('rolls back immediately and reports a rejection', () => {
    const connection = new FakeConnection();
    const failed = vi.fn();
    const session = new RemoteGameSession(connection as unknown as GameConnection, failed);
    session.orderMove('a', 50, 70);
    connection.settle?.(false, 'No route.');
    expect(session.army('a')?.moveOrder).toBeNull();
    expect(failed).toHaveBeenCalledWith('No route.');
  });

  it('waits for war confirmation, then re-sends the same order with consent', () => {
    const connection = new FakeConnection();
    const session = new RemoteGameSession(connection as unknown as GameConnection, vi.fn());
    let respond: ((confirmed: boolean) => void) | undefined;
    session.addEventListener('war-confirmation', (event) => {
      const detail = (event as CustomEvent<{ countryIds: number[]; respond: (confirmed: boolean) => void }>).detail;
      expect(detail.countryIds).toEqual([2]);
      respond = detail.respond;
    });

    session.orderMove('a', 50, 70);
    connection.settle?.(false, 'War declaration required.', [2]);
    expect(respond).toBeTypeOf('function');
    expect(session.army('a')?.moveOrder).toBeNull();

    respond?.(true);
    expect(connection.commands).toHaveLength(2);
    expect(connection.commands[1]).toMatchObject({
      type: 'moveArmy', armyId: 'a', x: 50, z: 70, confirmedWarCountryIds: [2],
    });
    expect(session.army('a')?.moveOrder).toEqual({ x: 50, z: 70 });
  });

  it('fails an unacknowledged command after five seconds', () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('WebSocket', { OPEN: 1 });
    const connection = new GameConnection();
    (connection as unknown as { socket: { readyState: number; send: (message: string) => void } }).socket = { readyState: 1, send: vi.fn() };
    const settled = vi.fn();
    connection.command({ type: 'stopArmy', armyId: 'a' }, settled);
    vi.advanceTimersByTime(4_999);
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(settled).toHaveBeenCalledWith(false, 'Command timed out.');
    vi.unstubAllGlobals();
  });
});
