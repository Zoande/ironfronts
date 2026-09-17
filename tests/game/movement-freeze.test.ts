import { describe, expect, it } from 'vitest';
import { GAME_STATE_VERSION, emptyStockpile, type GameState } from '../../src/game/game-state';
import { TERRAIN_CLASS } from '../../src/game/world-data';
import { buildLandGraph, type LandGraph } from '../../src/game/movement/graph';
import type { SimContext } from '../../src/game/sim-context';
import type { WorldData } from '../../src/game/world-data';
import { stepMovement } from '../../src/game/units/movement';
import { makeGroup, type ArmyStack } from '../../src/game/units/army';

/**
 * Node 1 sits 0.2 units from node 0 — a zero-length road-graph edge, which the
 * real world graph produces wherever two road vertices straddle a `GRAPH_CELL`
 * boundary. The route is 0 -> 1 -> 2.
 */
function coincidentNodeGraph(): LandGraph {
  return buildLandGraph(new Float32Array([
    100, 100, 100.2, 100, 1, 0, 0, 0,
    100.2, 100, 300, 100, 1, 0, 0, 0,
  ]), 10_000, 5_000);
}

function mountainWorld(): WorldData {
  return {
    width: 10_000, height: 5_000,
    provinces: [{
      id: 10, center: [100, 100], terrainId: 2, population: 0, coastal: false, urban: false,
    }],
    countries: [{ id: 1, name: 'A', color: '#fff', capitalProvinceId: 10 }],
    provinceOwner: () => 1,
    provinceAt: () => 10,
    // Mountain: 0.48 x road 1.35 => per-tick advance ~0.83, under the old
    // `Math.max(1, segLen)` floor — the exact case that froze stacks.
    terrainClassAt: () => TERRAIN_CLASS.mountain,
    connections: new Float32Array(0),
    resourceNodes: [],
  } as unknown as WorldData;
}

function movingArmy(): ArmyStack {
  return {
    id: 'a1', ownerCountryId: 1, name: '1st', x: 100, z: 100, graphNodeId: 0,
    units: [makeGroup('infantry', 3)],
    status: 'moving', extractingNodeId: null,
    order: {
      path: [1, 2], destX: 300, destZ: 100, intent: 'move',
      target: { kind: 'position', x: 300, z: 100 }, edgeProgress: 0,
    },
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
    provinceOwners: { 10: 1 },
    provinceBuildings: {}, productionQueues: {}, constructionQueues: {}, rallyPoints: {},
    armies: { a1: army },
    resourceNodes: {}, relations: {}, battles: {}, battleFronts: {},
    nextArmyId: 2, nextBattleId: 1, nextOrderId: 1, nextEventId: 1,
  };
  return { state, graph: coincidentNodeGraph(), world: mountainWorld() };
}

describe('movement: zero-length graph edges', () => {
  it('a stack on slow terrain steps through a coincident node instead of freezing', () => {
    const army = movingArmy();
    const c = ctx(army);

    // 400 authoritative ticks (~20 game-hours).
    for (let i = 0; i < 400; i += 1) stepMovement(c, 0.05);

    // Before the fix the stack sat at x ~= 100.2 with status still 'moving'
    // and order.path still [1, 2] — "Moving to destination" forever.
    expect(army.x).toBeGreaterThan(150);
    expect(army.graphNodeId).toBeGreaterThanOrEqual(1);
  });

  it('reaches the destination and goes idle', () => {
    const army = movingArmy();
    const c = ctx(army);
    for (let i = 0; i < 600; i += 1) stepMovement(c, 0.05);

    expect(army.order).toBeNull();
    expect(army.status).toBe('idle');
    expect(Math.abs(army.x - 300)).toBeLessThan(2);
  });
});
