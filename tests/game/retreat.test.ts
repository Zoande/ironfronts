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
      const events = stepCombat(c, 900);
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

  it('fights to the end when there is nowhere to retreat', () => {
    const c = ctx(false); // country 2 owns no province
    for (let i = 0; i < 20 && c.state.armies.weak; i += 1) {
      stepCombat(c, 900);
    }
    // it died in place rather than retreating
    expect(c.state.armies.weak).toBeUndefined();
  });
});
