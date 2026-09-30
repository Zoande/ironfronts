import { describe, expect, it } from 'vitest';
import { buildLandGraph } from '../../src/game/movement/graph';
import { GAME_STATE_VERSION, emptyStockpile, type GameState } from '../../src/game/game-state';
import { TERRAIN_CLASS, type WorldData } from '../../src/game/world-data';
import type { SimContext } from '../../src/game/sim-context';
import {
  stepMovement, issueMoveOrder, issueStop, NAVAL_DWELL_HOURS,
} from '../../src/game/units/movement';
import { makeGroup, type ArmyStack } from '../../src/game/units/army';
import { validateWorldState } from '../../src/game/state-invariants';
import { orderRouteForClient } from '../../apps/game-server/src/projection';

/** Stride-8 connection record helper: [x1,y1,x2,y2,medium,0,0,0]. */
function seg(x1: number, y1: number, x2: number, y2: number, land: boolean): number[] {
  return [x1, y1, x2, y2, land ? 1 : 0, 0, 0, 0];
}

/** Two islands (node 0 at x=0, node 1 at x=1000) linked only by a sea edge —
 *  no land path exists, matching a raw world graph's real ferry-edge shape. */
function twoIslandGraph() {
  const conn = new Float32Array([...seg(0, 0, 1000, 0, false)]);
  return buildLandGraph(conn, 10_000, 5_000);
}

function seaWorld(): WorldData {
  return {
    width: 10_000, height: 5_000,
    provinces: [
      { id: 10, center: [0, 0], terrainId: 0, population: 0, coastal: true, urban: false },
      { id: 20, center: [1000, 0], terrainId: 0, population: 0, coastal: true, urban: false },
    ],
    countries: [{ id: 1, name: 'A', color: '#fff', capitalProvinceId: 10 }],
    provinceOwner: (id: number) => (id === 10 ? 1 : 0),
    provinceAt: (x: number) => (x < 500 ? 10 : 20),
    terrainClassAt: () => TERRAIN_CLASS.plain,
    connections: new Float32Array(0),
    resourceNodes: [],
  } as unknown as WorldData;
}

function seaArmy(): ArmyStack {
  return {
    id: 'a1', ownerCountryId: 1, name: '1st', x: 0, z: 0, graphNodeId: 0,
    units: [makeGroup('infantry', 3)],
    status: 'idle', extractingNodeId: null, order: null,
  } as unknown as ArmyStack;
}

function ctx(army: ArmyStack): SimContext {
  const state: GameState = {
    version: GAME_STATE_VERSION, seed: 1, scenarioId: 'OP-1939-01', mode: 'campaign',
    fogOfWar: false, economyEnabled: false,
    clock: { gameTimeHours: 0, startDate: 'x' }, simulationTick: 0,
    countries: {
      1: {
        id: 1, name: 'A', color: '#fff', controller: 'player',
        stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1,
      },
    },
    provinceOwners: { 10: 1, 20: 0 },
    provinceBuildings: {}, productionQueues: {}, constructionQueues: {}, rallyPoints: {},
    armies: { a1: army },
    resourceNodes: {}, relations: {}, battles: {}, battleFronts: {},
    nextDiplomacyId: 1, nextArmyId: 2, nextBattleId: 1, nextFrontId: 1, nextOrderId: 1, nextEventId: 1,
  };
  return { state, graph: twoIslandGraph(), world: seaWorld() };
}

describe('naval crossing (embark / at sea / disembark)', () => {
  it('sails to an exact water destination, remains a transport, and can return to land', () => {
    const army = seaArmy();
    const base = ctx(army);
    const c: SimContext = { ...base, world: { ...base.world,
      provinceAt: (x: number) => x < 20 ? 10 : x > 992 && x < 1008 ? 20 : -1,
      terrainClassAt: (x: number) => x < 20 || x > 980 && x < 1020
        ? TERRAIN_CLASS.plain : TERRAIN_CLASS.water,
    } };
    expect(issueMoveOrder(c, army.id, 450, 100).ok).toBe(true);
    expect(army.order?.seaDestination).toMatchObject({ x: 450, z: 100 });
    expect(orderRouteForClient(army.order!, c.graph, army.x, army.z)?.at(-1))
      .toEqual({ x: 450, z: 100 });
    for (let i = 0; i < 100 && army.order; i += 1) stepMovement(c, 5);
    expect(army.order).toBeNull();
    expect(army.status).toBe('atSea');
    expect(army.transport).not.toBeNull();
    expect([army.x, army.z]).toEqual([450, 100]);
    expect(() => validateWorldState(c)).not.toThrow();

    expect(issueMoveOrder(c, army.id, 600, 150).ok).toBe(true);
    expect(army.navalCrossing?.returningToAnchor).toBe(true);
    expect(() => validateWorldState(c)).not.toThrow();
    expect(orderRouteForClient(army.order!, c.graph, army.x, army.z, null,
      { x: 0, z: 0 })).toEqual([
      { x: 450, z: 100 }, { x: 0, z: 0 }, { x: 1000, z: 0 }, { x: 600, z: 150 },
    ]);
    for (let i = 0; i < 100 && army.order; i += 1) stepMovement(c, 5);
    expect([army.x, army.z]).toEqual([600, 150]);
    expect(army.status).toBe('atSea');

    expect(issueMoveOrder(c, army.id, 1000, 0).ok).toBe(true);
    for (let i = 0; i < 100 && army.order; i += 1) stepMovement(c, 5);
    expect(army.status).toBe('idle');
    expect(army.transport).toBeNull();
    expect(army.x).toBe(1000);
  });
  it('follows a sea-graph crossing before the final open-water leg', () => {
    const army = seaArmy();
    const base = ctx(army);
    const c: SimContext = { ...base, world: { ...base.world,
      provinceAt: (x: number) => x < 20 ? 10 : x > 992 && x < 1008 ? 20 : -1,
      terrainClassAt: () => TERRAIN_CLASS.water,
    } };
    expect(issueMoveOrder(c, army.id, 850, 100).ok).toBe(true);
    expect(army.order?.path).toEqual([1]);
    for (let i = 0; i < 100 && army.order; i += 1) stepMovement(c, 5);
    expect([army.x, army.z]).toEqual([850, 100]);
    expect(army.status).toBe('atSea');
    expect(army.transport).not.toBeNull();
    expect(() => validateWorldState(c)).not.toThrow();
  });
  it('reaches a destination on another landmass via a sea/ferry edge — unreachable on land alone', () => {
    const army = seaArmy();
    const c = ctx(army);
    // Sanity: the two nodes are NOT in the same land-only component.
    expect(c.graph.component[0]).not.toBe(c.graph.component[1]);

    const result = issueMoveOrder(c, 'a1', 1000, 0);
    expect(result.ok).toBe(true);
  });

  it('walks through embarking -> atSea -> disembarking -> idle, arriving at the destination node', () => {
    const army = seaArmy();
    const c = ctx(army);
    issueMoveOrder(c, 'a1', 1000, 0);

    // First tick only transitions 'moving' -> 'embarking' (the dwell timer
    // starts fresh from here, matching how the construction/devastation
    // timers elsewhere never charge the tick that triggers them).
    stepMovement(c, 1);
    expect(army.status).toBe('embarking');
    expect(army.x).toBe(0);

    // Embark dwell: stays put and stays 'embarking' until the full timer elapses.
    stepMovement(c, NAVAL_DWELL_HOURS / 2);
    expect(army.status).toBe('embarking');
    stepMovement(c, NAVAL_DWELL_HOURS / 2 + 1);
    expect(army.status).toBe('atSea');

    // Cross the 1000-unit sea edge (coarse dt — a pure state-machine test).
    for (let i = 0; i < 2000 && (army.status as string) === 'atSea'; i += 1) stepMovement(c, 5);
    expect(army.status).toBe('disembarking');
    expect(army.graphNodeId).toBe(1);
    expect(Math.abs(army.x - 1000)).toBeLessThan(2);

    stepMovement(c, NAVAL_DWELL_HOURS + 1);
    expect(army.status).toBe('idle');
    expect(army.order).toBeNull();
    expect(army.navalCrossing).toBeNull();
  });

  it('cannot be moved, stopped, or re-ordered while mid-crossing', () => {
    const army = seaArmy();
    const c = ctx(army);
    issueMoveOrder(c, 'a1', 1000, 0);
    stepMovement(c, 1); // now embarking

    expect(issueStop(c, 'a1')).toBe(false);
    expect(issueMoveOrder(c, 'a1', 0, 0).ok).toBe(false);

    stepMovement(c, NAVAL_DWELL_HOURS); // now atSea
    expect(issueStop(c, 'a1')).toBe(false);
    expect(issueMoveOrder(c, 'a1', 0, 0).ok).toBe(false);
  });

  it('snapshots naval technology and moves at transport speed without a road bonus', () => {
    const army = seaArmy();
    const c = ctx(army);
    c.state.countries[1].technologies = {
      infantry: 1, resources: 1, resourceBuildings: 1, training: 1,
      hybrid: 1, armored: 1, navy: 3,
    };
    issueMoveOrder(c, 'a1', 1000, 0);
    stepMovement(c, 1);
    expect(army.transport?.level).toBe(3);

    // Research completed after embark begins does not refit ships mid-voyage.
    c.state.countries[1].technologies.navy = 8;
    stepMovement(c, NAVAL_DWELL_HOURS + 0.01);
    expect(army.status).toBe('atSea');
    expect(army.transport?.level).toBe(3);

    stepMovement(c, 1);
    expect(army.x).toBeCloseTo(108, 6);
    expect(() => validateWorldState(c)).not.toThrow();
  });
});
