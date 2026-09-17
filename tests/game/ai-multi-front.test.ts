import { describe, expect, it } from 'vitest';
import { stepAi } from '../../src/game/ai/simple-ai';
import { GAME_STATE_VERSION, emptyStockpile, type GameState } from '../../src/game/game-state';
import type { LandGraph } from '../../src/game/movement/graph';
import type { SimContext } from '../../src/game/sim-context';
import { makeGroup, stackHp, type ArmyStack } from '../../src/game/units/army';
import { TERRAIN_CLASS, type WorldData, type WorldProvince } from '../../src/game/world-data';

const X = [0, 500, 2_000, 3_000, 4_000, 5_500, 7_000];

function graph(): LandGraph {
  const adjacency = X.map((_, index) => [index - 1, index + 1].filter((node) => node >= 0 && node < X.length));
  return {
    nodeX: Float64Array.from(X), nodeZ: new Float64Array(X.length).fill(100), adjacency,
    edgeCost: adjacency.map((row, index) => row.map((node) => Math.abs(X[node] - X[index]))),
    seaAdjacency: X.map(() => []), seaEdgeCost: X.map(() => []),
    component: new Int32Array(X.length), componentSize: [X.length], nodeCount: X.length,
    width: 10_000, height: 5_000,
  } as unknown as LandGraph;
}

function world(): WorldData {
  const provinces: WorldProvince[] = X.map((x, index) => ({
    id: 10 + index, center: [x, 100], terrainId: 0, population: 1_000,
    coastal: false, urban: index === 0,
  }));
  return {
    width: 10_000, height: 5_000, provinces,
    countries: [
      { id: 1, name: 'Germany', color: '#777', capitalProvinceId: 15 },
      { id: 2, name: 'Belgium', color: '#cc8', capitalProvinceId: 10 },
      { id: 3, name: 'Poland', color: '#d88', capitalProvinceId: 16 },
    ],
    provinceOwner: (id) => id <= 14 ? 2 : id === 15 ? 1 : 3,
    provinceAt: (x) => provinces.reduce((best, province) => (
      Math.abs(province.center[0] - x) < Math.abs(best.center[0] - x) ? province : best
    )).id,
    terrainClassAt: () => TERRAIN_CLASS.plain,
    connections: new Float32Array(0), resourceNodes: [],
  } as WorldData;
}

function country(id: number, name: string, controller: 'player' | 'ai') {
  return {
    id, name, color: '#fff', controller, stockpile: emptyStockpile(), income: emptyStockpile(),
    industryCapacity: 1, warheads: 0,
  };
}

function stack(id: string, ownerCountryId: number, node: number, count: number, status: ArmyStack['status'] = 'idle'): ArmyStack {
  return {
    id, ownerCountryId, name: id, x: X[node], z: 100, graphNodeId: node,
    units: [makeGroup('infantry', count)], status, order: null, extractingNodeId: null,
  };
}

function context(): SimContext {
  const reserveWest = stack('be-reserve-west', 2, 1, 6);
  const reserveEast = stack('be-reserve-east', 2, 1, 6);
  const guard = stack('be-capital', 2, 0, 3);
  const west = stack('be-west', 2, 2, 2, 'engaged');
  const east = stack('be-east', 2, 4, 2, 'engaged');
  const germanWest = stack('de-west', 1, 2, 8, 'engaged');
  const germanEast = stack('de-east', 1, 4, 8, 'engaged');
  west.battleFrontIds = ['front-west'];
  east.battleFrontIds = ['front-east'];
  germanWest.battleFrontIds = ['front-west'];
  germanEast.battleFrontIds = ['front-east'];
  const armies = Object.fromEntries(
    [reserveWest, reserveEast, guard, west, east, germanWest, germanEast].map((army) => [army.id, army]),
  );
  const state = {
    version: GAME_STATE_VERSION, seed: 1, scenarioId: 'OP-1939-01', mode: 'campaign',
    fogOfWar: false, economyEnabled: false, clock: { gameTimeHours: 0, startDate: 'x' }, simulationTick: 1,
    countries: {
      1: country(1, 'Germany', 'player'), 2: country(2, 'Belgium', 'ai'), 3: country(3, 'Poland', 'ai'),
    },
    provinceOwners: { 10: 2, 11: 2, 12: 2, 13: 2, 14: 2, 15: 1, 16: 3 },
    provinceBuildings: {}, productionQueues: {}, constructionQueues: {}, rallyPoints: {}, armies,
    battles: {
      'battle-west': { id: 'battle-west', frontIds: ['front-west'] },
      'battle-east': { id: 'battle-east', frontIds: ['front-east'] },
    },
    battleFronts: {
      'front-west': {
        id: 'front-west', battleId: 'battle-west', anchorNodeId: 2, kind: 'province', provinceId: 12,
        x: X[2], z: 100,
        sideA: { countryId: 2, directionNodeId: 1, role: 'defense', armyIds: [west.id], entryMaxHpByArmy: { [west.id]: stackHp(west) } },
        sideB: { countryId: 1, directionNodeId: 3, role: 'attack', armyIds: [germanWest.id], entryMaxHpByArmy: { [germanWest.id]: stackHp(germanWest) } },
      },
      'front-east': {
        id: 'front-east', battleId: 'battle-east', anchorNodeId: 4, kind: 'province', provinceId: 14,
        x: X[4], z: 100,
        sideA: { countryId: 2, directionNodeId: 3, role: 'defense', armyIds: [east.id], entryMaxHpByArmy: { [east.id]: stackHp(east) } },
        sideB: { countryId: 1, directionNodeId: 5, role: 'attack', armyIds: [germanEast.id], entryMaxHpByArmy: { [germanEast.id]: stackHp(germanEast) } },
      },
    },
    resourceNodes: {}, relations: { '1:2': 'war', '1:3': 'war' },
    diplomacyMessages: {}, diplomacyProposals: {}, nextDiplomacyId: 1,
    nextArmyId: 20, nextBattleId: 3, nextOrderId: 1, nextEventId: 1,
  } as unknown as GameState;
  return { state, graph: graph(), world: world() };
}

describe('strategic AI across simultaneous wars and fronts', () => {
  it('reinforces both threatened Belgian fronts while Germany is also at war with Poland', () => {
    const ctx = context();

    stepAi(ctx, 2);

    const reserves = [ctx.state.armies['be-reserve-west'], ctx.state.armies['be-reserve-east']];
    expect(reserves.every((army) => army.order?.intent === 'move')).toBe(true);
    expect(new Set(reserves.map((army) => army.order?.destX))).toEqual(new Set([X[2], X[4]]));
    expect(ctx.state.relations).toMatchObject({ '1:2': 'war', '1:3': 'war' });
  });
});
