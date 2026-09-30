/**
 * A badly beaten, out-fought stack withdraws to its nearest owned province
 * instead of fighting to annihilation — but only if it has somewhere to run.
 */

import { describe, expect, it } from 'vitest';
import { GAME_STATE_VERSION, emptyStockpile, type GameState } from '../../src/game/game-state';
import { buildLandGraph, type LandGraph } from '../../src/game/movement/graph';
import type { SimContext } from '../../src/game/sim-context';
import type { WorldData, WorldProvince } from '../../src/game/world-data';
import { issueManualRetreat, legalRetreatPaths, stepCombat } from '../../src/game/combat';
import type { ArmyStack } from '../../src/game/units/army';
import { issueRetreatOrder, retreatPaths } from '../../src/game/movement/retreat';
import { validateWorldState } from '../../src/game/state/state-invariants';
import { stepMovement } from '../../src/game/units/movement';

function prov(id: number, x: number, z: number): WorldProvince {
  return { id, center: [x, z], terrainId: 0, population: 100, coastal: false, urban: false };
}

function graph(): LandGraph {
  // Node 0 at the battle site (100,100); node 1 at the safe town (900,100).
  return buildLandGraph(new Float32Array([100, 100, 900, 100, 1, 0, 0, 0]), 10_000, 5_000);
}

function ctx(homeOwnedBy2: boolean): SimContext {
  const provinces = [prov(10, 100, 100)];
  if (homeOwnedBy2) provinces.push(prov(20, 900, 100));
  const world: WorldData = {
    width: 10_000, height: 5_000, provinces,
    countries: [
      { id: 1, name: 'A', color: '#fff', capitalProvinceId: 10 },
      { id: 2, name: 'B', color: '#000', capitalProvinceId: homeOwnedBy2 ? 20 : -1 },
    ],
    provinceOwner: () => 0, provinceAt: () => -1, terrainClassAt: () => 0,
    connections: new Float32Array(0), resourceNodes: [],
  };
  const state: GameState = {
    version: GAME_STATE_VERSION, seed: 1, scenarioId: 'OP-1939-01', mode: 'campaign',
    fogOfWar: false, economyEnabled: false,
    clock: { gameTimeHours: 0, startDate: 'x' }, simulationTick: 0,
    countries: {
      1: { id: 1, name: 'A', color: '#fff', controller: 'player', stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1 },
      2: { id: 2, name: 'B', color: '#000', controller: 'ai', stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1 },
    },
    provinceOwners: homeOwnedBy2 ? { 10: 1, 20: 2 } : { 10: 1 },
    provinceBuildings: {}, productionQueues: {}, constructionQueues: {}, rallyPoints: {},
    armies: {
      fist: {
        id: 'fist', ownerCountryId: 1, name: 'Fist', x: 100, z: 100, graphNodeId: 0,
        units: [{ typeId: 'medium-tank', count: 1, hp: 190, experience: 0 }],
        status: 'idle', order: null, extractingNodeId: null,
      } satisfies ArmyStack,
      weak: {
        id: 'weak', ownerCountryId: 2, name: 'Militia', x: 100, z: 100, graphNodeId: 0,
        units: [{ typeId: 'infantry', count: 3, hp: 90, experience: 0 }], // already at 30% hp
        status: 'idle', order: null, extractingNodeId: null,
      } satisfies ArmyStack,
    },
    resourceNodes: {}, relations: { '1:2': 'war' }, battles: {}, battleFronts: {},
    nextArmyId: 1, nextBattleId: 1, nextOrderId: 1, nextEventId: 1,
  };
  return { state, graph: graph(), world };
}

describe('retreat', () => {
  it('projects only the shortest route for each selectable exit direction', () => {
    const c = ctx(true);
    (c.world.provinces as WorldProvince[]).push(prov(21, 850, 100));
    c.state.provinceOwners[21] = 2;
    c.state.armies.weak.units[0].hp = 300;
    stepCombat(c, 0.25);
    const routes = legalRetreatPaths(c, 'weak');
    expect(routes).toHaveLength(1);
    expect(routes[0].firstNodeId).toBe(1);
    expect(routes[0].destinationProvinceId).toBe(20);
    const result = issueManualRetreat(c, 'weak', 900, 100);
    expect(result).toEqual({ ok: true });
    expect(c.state.armies.weak.status).toBe('retreating');
    expect(c.state.armies.weak.order?.destX).toBeGreaterThan(500);
  });

  it('withdraws a beaten stack toward its nearest owned province', () => {
    const c = ctx(true);
    let retreated = false;
    for (let i = 0; i < 8 && c.state.armies.weak; i += 1) {
      const events = stepCombat(c, 0.05);
      if (events.some((e) => e.kind === 'retreat' && e.defender === 2)) retreated = true;
      if (retreated) break;
    }
    expect(retreated).toBe(true);
    const weak = c.state.armies.weak;
    expect(weak).toBeDefined();
    expect(weak.status).toBe('retreating');
    expect(weak.order).not.toBeNull();
    // heading for province 20 at x≈900
    expect(weak.order!.destX).toBeGreaterThan(500);
  });

  it('offers a retreat route for a stationary defender that never moved (road front, no lastGraphNodeId)', () => {
    // Battle node (500,100) deliberately does not coincide with any province
    // center, so provinceAtNode returns null and the front is kind:'road' —
    // the branch that used to require lastGraphNodeId and returned no exits
    // at all for an army that had never moved (see src/game/combat/retreat.ts).
    const roadGraph = buildLandGraph(new Float32Array([500, 100, 900, 100, 1, 0, 0, 0]), 10_000, 5_000);
    const provinces = [prov(10, 100, 100), prov(20, 900, 100)];
    const world: WorldData = {
      width: 10_000, height: 5_000, provinces,
      countries: [
        { id: 1, name: 'A', color: '#fff', capitalProvinceId: 10 },
        { id: 2, name: 'B', color: '#000', capitalProvinceId: 20 },
      ],
      provinceOwner: () => 0, provinceAt: () => -1, terrainClassAt: () => 0,
      connections: new Float32Array(0), resourceNodes: [],
    };
    const state: GameState = {
      version: GAME_STATE_VERSION, seed: 1, scenarioId: 'OP-1939-01', mode: 'campaign',
      fogOfWar: false, economyEnabled: false,
      clock: { gameTimeHours: 0, startDate: 'x' }, simulationTick: 0,
      countries: {
        1: { id: 1, name: 'A', color: '#fff', controller: 'player', stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1 },
        2: { id: 2, name: 'B', color: '#000', controller: 'ai', stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1 },
      },
      provinceOwners: { 10: 1, 20: 2 },
      provinceBuildings: {}, productionQueues: {}, constructionQueues: {}, rallyPoints: {},
      armies: {
        fist: {
          id: 'fist', ownerCountryId: 1, name: 'Fist', x: 500, z: 100, graphNodeId: 0,
          units: [{ typeId: 'medium-tank', count: 1, hp: 190, experience: 0 }],
          status: 'idle', order: null, extractingNodeId: null,
        } satisfies ArmyStack,
        weak: {
          id: 'weak', ownerCountryId: 2, name: 'Militia', x: 500, z: 100, graphNodeId: 0,
          units: [{ typeId: 'infantry', count: 3, hp: 300, experience: 0 }],
          status: 'idle', order: null, extractingNodeId: null,
        } satisfies ArmyStack,
      },
      resourceNodes: {}, relations: { '1:2': 'war' }, battles: {}, battleFronts: {},
      nextArmyId: 1, nextBattleId: 1, nextOrderId: 1, nextEventId: 1,
    };
    const c: SimContext = { state, graph: roadGraph, world };
    expect(c.state.armies.weak.lastGraphNodeId).toBeUndefined();
    stepCombat(c, 0.25);
    const front = Object.values(c.state.battleFronts)[0];
    expect(front?.kind).toBe('road');
    const routes = legalRetreatPaths(c, 'weak');
    expect(routes).toHaveLength(1);
    expect(routes[0].firstNodeId).toBe(1);
    expect(routes[0].destinationProvinceId).toBe(20);
  });

  it('keeps the edge origin as the first target when turning back mid-edge', () => {
    // Node 0 is the battle site; the army is mid-transit toward node 1 (the
    // enemy-ward edge) when it breaks, so it must turn back through node 0
    // toward the safe rear province at node 2. RetreatPath uses the same
    // inclusive-current-node convention as ordinary routing, so node 0 must
    // appear twice: installOrder removes the first and leaves the second as
    // the physical turn-back target.
    const threeNodeGraph = buildLandGraph(new Float32Array([
      100, 100, 300, 100, 1, 0, 0, 0,
      100, 100, 900, 100, 1, 0, 0, 0,
    ]), 10_000, 5_000);
    const provinces = [prov(10, 100, 100), prov(20, 900, 100)];
    const world: WorldData = {
      width: 10_000, height: 5_000, provinces,
      countries: [
        { id: 1, name: 'A', color: '#fff', capitalProvinceId: 10 },
        { id: 2, name: 'B', color: '#000', capitalProvinceId: 20 },
      ],
      provinceOwner: () => 0, provinceAt: () => -1, terrainClassAt: () => 0,
      connections: new Float32Array(0), resourceNodes: [],
    };
    const state: GameState = {
      version: GAME_STATE_VERSION, seed: 1, scenarioId: 'OP-1939-01', mode: 'campaign',
      fogOfWar: false, economyEnabled: false,
      clock: { gameTimeHours: 0, startDate: 'x' }, simulationTick: 0,
      countries: {
        2: { id: 2, name: 'B', color: '#000', controller: 'ai', stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1 },
      },
      provinceOwners: { 20: 2 },
      provinceBuildings: {}, productionQueues: {}, constructionQueues: {}, rallyPoints: {},
      armies: {
        weak: {
          id: 'weak', ownerCountryId: 2, name: 'Militia', x: 150, z: 100, graphNodeId: 0,
          edge: { from: 0, to: 1 },
          units: [{ typeId: 'infantry', count: 3, hp: 300, experience: 0 }],
          status: 'engaged', order: null, extractingNodeId: null,
        } satisfies ArmyStack,
      },
      resourceNodes: {}, relations: {}, battles: {}, battleFronts: {},
      nextArmyId: 1, nextBattleId: 1, nextOrderId: 1, nextEventId: 1,
    };
    const c: SimContext = { state, graph: threeNodeGraph, world };
    const routes = retreatPaths(c, c.state.armies.weak, [0]);
    expect(routes).toHaveLength(1);
    expect(routes[0].path[0]).toBe(0);
    expect(routes[0].path[1]).toBe(0);
    expect(routes[0].path[routes[0].path.length - 1]).toBe(2);
    expect(routes[0].length).toBeGreaterThan(0);
    expect(routes[0].length).toBeLessThan(Infinity);
    issueRetreatOrder(c, c.state.armies.weak, routes[0]);
    expect(c.state.armies.weak.order?.path[0]).toBe(0);
    c.state.nextFrontId ??= 1;
    c.state.nextDiplomacyId ??= 1;
    c.state.diplomacyMessages ??= {};
    c.state.diplomacyProposals ??= {};
    expect(() => validateWorldState(c)).not.toThrow();
    stepMovement(c, 1 / 3600);
    expect(c.state.armies.weak.x).toBeLessThan(150);
  });

  it('fights to the end when there is nowhere to retreat', () => {
    const c = ctx(false); // country 2 owns no province
    for (let i = 0; i < 20 && c.state.armies.weak; i += 1) {
      stepCombat(c, 0.05);
    }
    // it died in place rather than retreating
    expect(c.state.armies.weak).toBeUndefined();
  });

  it('reports battleEnded with the surviving country once one side is wiped out', () => {
    const c = ctx(false); // country 2 owns no province
    const events: ReturnType<typeof stepCombat> = [];
    for (let i = 0; i < 20 && c.state.armies.weak; i += 1) {
      events.push(...stepCombat(c, 0.05));
    }
    const ended = events.find((e) => e.kind === 'battleEnded');
    expect(ended?.kind).toBe('battleEnded');
    expect((ended as { survivorCountryId: number | null }).survivorCountryId).toBe(1);
  });
});
