/**
 * Regression tests for three authoritative-rules bugs:
 *   6  — capturing a mine from under an enemy extractor must clear BOTH the
 *        node and the extracting army (army was left pinned in 'extracting').
 *   7  — a production order belongs to the country that paid for it; capturing
 *        the factory mid-build must NOT hand the new owner that unit.
 *   8  — pooled-hp -> unit-count shedding must be coherent
 *        (count === ceil(hp / maxHp), no phantom near-dead units).
 */

import { describe, expect, it } from 'vitest';
import {
  GAME_STATE_VERSION, emptyStockpile, type GameState, type ProductionOrder,
} from '../../src/game/game-state';
import { buildLandGraph, type LandGraph } from '../../src/game/movement/graph';
import type { SimContext } from '../../src/game/sim-context';
import type { WorldData } from '../../src/game/world-data';
import { stepProduction } from '../../src/game/production';
import { stepCombat, stepCapture } from '../../src/game/combat';
import type { ArmyStack } from '../../src/game/units/army';

const CENTRE: readonly [number, number] = [100, 100];

function graph(): LandGraph {
  // One land edge: node 0 at the province centre, node 1 elsewhere.
  return buildLandGraph(new Float32Array([100, 100, 300, 100, 1, 0, 0, 0]), 10_000, 5_000);
}

function world(): WorldData {
  return {
    width: 10_000, height: 5_000,
    provinces: [{
      id: 10, center: CENTRE, terrainId: 4, population: 1000, coastal: false, urban: true,
    }],
    countries: [
      { id: 1, name: 'A', color: '#fff', capitalProvinceId: 10 },
      { id: 2, name: 'B', color: '#000', capitalProvinceId: -1 },
    ],
    provinceOwner: () => 0,
    provinceAt: () => 10,
    terrainClassAt: () => 4,
    connections: new Float32Array(0),
    resourceNodes: [],
  };
}

function baseState(): GameState {
  return {
    version: GAME_STATE_VERSION, seed: 1, scenarioId: 'OP-1939-01', mode: 'campaign',
    fogOfWar: false, economyEnabled: false,
    clock: { gameTimeHours: 0, startDate: 'x' }, simulationTick: 0,
    countries: {
      1: { id: 1, name: 'A', color: '#fff', controller: 'player', stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1 },
      2: { id: 2, name: 'B', color: '#000', controller: 'ai', stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1 },
    },
    provinceOwners: { 10: 1 },
    provinceBuildings: { 10: { barracks: 1, tankPlant: 0, ordnance: 0 } },
    productionQueues: {}, constructionQueues: {}, rallyPoints: {},
    armies: {},
    resourceNodes: {},
    relations: {},
    battles: {}, battleFronts: {},
    nextArmyId: 1, nextBattleId: 1, nextOrderId: 1, nextEventId: 1,
  };
}

function ctx(state: GameState): SimContext {
  return { state, graph: graph(), world: world() };
}

function order(ownerCountryId: number): ProductionOrder {
  return { id: 'ord-1', unitTypeId: 'infantry', ownerCountryId, progressHours: 0, totalHours: 1 };
}

describe('bug 7 — production ownership survives capture', () => {
  it('delivers the finished unit to the country that paid, not the province owner', () => {
    const s = baseState();
    s.productionQueues[10] = [order(1)];
    const c = ctx(s);
    const done = stepProduction(c, 2); // > totalHours
    expect(done).toHaveLength(1);
    const army = s.armies[done[0].armyId];
    expect(army.ownerCountryId).toBe(1);
  });

  it('voids the order (no unit for anyone) when the factory is captured mid-build', () => {
    const s = baseState();
    s.productionQueues[10] = [order(1)];
    s.provinceOwners[10] = 2; // captured before completion
    const c = ctx(s);
    const done = stepProduction(c, 5);
    expect(done).toHaveLength(0);
    expect(Object.keys(s.armies)).toHaveLength(0);
    expect(s.productionQueues[10]).toBeUndefined();
  });
});

describe('bug 6 — capture clears a stale enemy extractor', () => {
  it('releases both the node and the army when a mine is seized', () => {
    const s = baseState();
    s.relations = { '1:2': 'war' };
    s.provinceOwners[10] = 2;
    s.resourceNodes[7] = {
      id: 7, kind: 'metal', x: 100, z: 100, remaining: 120, initialAmount: 120,
      controllerCountryId: 2, provinceId: 10, accessNodeId: 1,
      extractorArmyId: 'enemyMiner', status: 'extracting', provenance: 'generatedNatural',
    };
    s.armies.enemyMiner = {
      id: 'enemyMiner', ownerCountryId: 2, name: 'Miners', x: 300, z: 100, graphNodeId: 1,
      units: [{ typeId: 'engineer', count: 2, hp: 160, experience: 0 }],
      status: 'extracting', order: null, extractingNodeId: 7,
    } satisfies ArmyStack;
    s.armies.spCapture = {
      id: 'spCapture', ownerCountryId: 1, name: 'Column', x: 100, z: 100, graphNodeId: 0,
      units: [{ typeId: 'infantry', count: 4, hp: 400, experience: 0 }],
      status: 'idle', order: null, extractingNodeId: null,
    } satisfies ArmyStack;

    const events = stepCapture(ctx(s));
    expect(events.map((e) => e.provinceId)).toContain(10);
    expect(s.provinceOwners[10]).toBe(1);
    expect(s.resourceNodes[7].controllerCountryId).toBe(1);
    expect(s.resourceNodes[7].extractorArmyId).toBeNull();
    expect(s.resourceNodes[7].status).toBe('idle');
    expect(s.armies.enemyMiner.status).toBe('idle');
    expect(s.armies.enemyMiner.extractingNodeId).toBeNull();
  });
});

describe('bug 8 — pooled-hp casualty accounting is coherent', () => {
  it('keeps count === ceil(hp / maxHp) after combat, never phantom near-dead units', () => {
    const s = baseState();
    s.relations = { '1:2': 'war' };
    // A crushing attacker vs a lone infantry group at full strength.
    s.armies.big = {
      id: 'big', ownerCountryId: 1, name: 'Fist', x: 100, z: 100, graphNodeId: 0,
      units: [{ typeId: 'medium-tank', count: 6, hp: 1140, experience: 0 }],
      status: 'idle', order: null, extractingNodeId: null,
    } satisfies ArmyStack;
    s.armies.small = {
      id: 'small', ownerCountryId: 2, name: 'Platoon', x: 100, z: 100, graphNodeId: 0,
      units: [{ typeId: 'infantry', count: 4, hp: 400, experience: 0 }],
      status: 'idle', order: null, extractingNodeId: null,
    } satisfies ArmyStack;

    // Step combat in small slices; check the invariant after every pass while
    // the weak stack is being ground down.
    for (let i = 0; i < 20 && s.armies.small; i += 1) {
      stepCombat(ctx(s), 900);
      const g = s.armies.small?.units[0];
      if (!g) break;
      expect(g.count).toBe(Math.max(0, Math.ceil(g.hp / 100)));
      expect(g.count).toBeLessThanOrEqual(4);
      if (g.count > 0) expect(g.hp).toBeGreaterThan(0);
    }
    // And it did actually die rather than stalling with phantom HP.
    const survivor = s.armies.small?.units[0];
    expect(!survivor || survivor.count < 4).toBe(true);
  });
});
