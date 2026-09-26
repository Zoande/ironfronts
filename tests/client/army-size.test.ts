import { describe, expect, it } from 'vitest';
import type { PlayerProjection, PresentationCatalogs, ProjectedArmy } from '../../packages/protocol/src/index';
import { GameConnection } from '../../src/client/game-connection';
import { RemoteGameSession } from '../../src/client/remote-session';

function army(overrides: Partial<ProjectedArmy>): ProjectedArmy {
  return {
    id: 'a', name: 'Army', ownerCountryId: 1, ownerName: 'A', ownerColor: '#fff',
    x: 0, z: 0, own: true, contact: 'visible', status: 'idle',
    composition: { unitCount: 0, health: 1, entrenchment: 0, stance: 'attack-defend' as const, inSupply: true, speed: 1, groups: [] },
    moveOrder: null,
    ...overrides,
  };
}

function state(armies: Record<string, ProjectedArmy>): PlayerProjection {
  return {
    simulationTick: 0, viewerCountryId: 1, startCamera: { x: 0, z: 0, distance: 900 },
    countries: { 1: { id: 1, name: 'A', color: '#fff', controller: 'player', alive: true } },
    provinceOwners: {}, provinceBuildings: {}, provinceActions: {}, productionQueues: {}, constructionQueues: {},
    rallyPoints: {},
    armies,
    resourceNodes: {},
    ownCountry: {
      id: 1, name: 'A', color: '#fff', controller: 'player',
      stockpile: { funds: 0, manpower: 0, food: 0, stone: 0, metal: 0, oil: 0 },
      income: { funds: 0, manpower: 0, food: 0, stone: 0, metal: 0, oil: 0 },
      industryCapacity: 1,
    },
    relations: {},
  };
}

class FakeConnection extends EventTarget {
  state: PlayerProjection;
  catalogs: PresentationCatalogs = { units: [], buildings: [] };
  constructor(initial: PlayerProjection) { super(); this.state = initial; }
  command(): string { return 'noop'; }
}

describe('RemoteGameSession.armySize', () => {
  it('sums unit counts across own army stacks only, ignoring foreign armies', () => {
    const connection = new FakeConnection(state({
      infantry: army({ id: 'infantry', own: true, composition: { unitCount: 4, health: 1, entrenchment: 0, stance: 'attack-defend' as const, inSupply: true, speed: 1, groups: [] } }),
      tanks: army({ id: 'tanks', own: true, composition: { unitCount: 2, health: 1, entrenchment: 0, stance: 'attack-defend' as const, inSupply: true, speed: 1, groups: [] } }),
      enemy: army({
        id: 'enemy', own: false, ownerCountryId: 2,
        composition: { unitCount: 99, health: 1, entrenchment: 0, stance: 'attack-defend' as const, inSupply: true, speed: 1, groups: [] },
      }),
    }));
    const session = new RemoteGameSession(connection as unknown as GameConnection, () => {});
    expect(session.armySize).toBe(6);
  });

  it('updates as armies are built (added) and destroyed (removed) via a state refresh', () => {
    const connection = new FakeConnection(state({
      infantry: army({ id: 'infantry', composition: { unitCount: 4, health: 1, entrenchment: 0, stance: 'attack-defend' as const, inSupply: true, speed: 1, groups: [] } }),
    }));
    const session = new RemoteGameSession(connection as unknown as GameConnection, () => {});
    expect(session.armySize).toBe(4);

    // A new tank stack is produced.
    connection.state = state({
      infantry: army({ id: 'infantry', composition: { unitCount: 4, health: 1, entrenchment: 0, stance: 'attack-defend' as const, inSupply: true, speed: 1, groups: [] } }),
      tanks: army({ id: 'tanks', composition: { unitCount: 1, health: 1, entrenchment: 0, stance: 'attack-defend' as const, inSupply: true, speed: 1, groups: [] } }),
    });
    connection.dispatchEvent(new Event('state'));
    expect(session.armySize).toBe(5);

    // The infantry stack is wiped out in combat and removed from the projection.
    connection.state = state({
      tanks: army({ id: 'tanks', composition: { unitCount: 1, health: 1, entrenchment: 0, stance: 'attack-defend' as const, inSupply: true, speed: 1, groups: [] } }),
    });
    connection.dispatchEvent(new Event('state'));
    expect(session.armySize).toBe(1);
  });

  it('ignores an own army with no composition yet (pre-projection edge case)', () => {
    const connection = new FakeConnection(state({
      ghost: army({ id: 'ghost', composition: null }),
    }));
    const session = new RemoteGameSession(connection as unknown as GameConnection, () => {});
    expect(session.armySize).toBe(0);
  });
});
