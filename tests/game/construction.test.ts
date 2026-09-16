/**
 * BUILD: an owned urban province constructs a production building over game
 * time. Cost is paid up front; completion raises the building level and unlocks
 * that unit line. Capturing the province mid-build voids the order.
 */

import { describe, expect, it } from 'vitest';
import { GAME_STATE_VERSION, emptyStockpile, type GameState } from '../../src/game/game-state';
import type { SimContext } from '../../src/game/sim-context';
import type { WorldData } from '../../src/game/world-data';
import {
  BUILDINGS, buildOptions, buildableBuildings, queueBuilding, stepConstruction,
} from '../../src/game/construction';
import { producibleUnits } from '../../src/game/production';

function world(urban = true): WorldData {
  return {
    width: 10_000, height: 5_000,
    provinces: [{ id: 10, center: [100, 100], terrainId: 4, population: 800, coastal: false, urban }],
    countries: [{ id: 1, name: 'A', color: '#fff', capitalProvinceId: 10 }],
    provinceOwner: () => 0, provinceAt: () => 10, terrainClassAt: () => 4,
    connections: new Float32Array(0), resourceNodes: [],
  };
}

function state(): GameState {
  return {
    version: GAME_STATE_VERSION, seed: 1, scenarioId: 'OP-1939-01', mode: 'campaign',
    fogOfWar: false, economyEnabled: false,
    clock: { gameTimeHours: 0, startDate: 'x' }, simulationTick: 0,
    countries: {
      // phase: 3 — this file tests affordability/dedup/ownership gating on
      // buildOptions, not phase progression (see phase.test.ts for that).
      1: { id: 1, name: 'A', color: '#fff', controller: 'player', stockpile: { ...emptyStockpile(), funds: 5000, stone: 5000, metal: 5000 }, income: emptyStockpile(), industryCapacity: 1, phase: 3 },
      2: { id: 2, name: 'B', color: '#000', controller: 'ai', stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1, phase: 3 },
    },
    provinceOwners: { 10: 1 },
    provinceBuildings: {},
    productionQueues: {}, constructionQueues: {}, rallyPoints: {},
    armies: {}, resourceNodes: {}, relations: {},
    battles: {}, battleFronts: {},
    nextArmyId: 1, nextBattleId: 1, nextOrderId: 1, nextEventId: 1,
  };
}

function ctx(s: GameState, urban = true): SimContext {
  return { state: s, graph: {} as never, world: world(urban) };
}

describe('queueBuilding', () => {
  it('deducts the cost up front and enqueues the order', () => {
    const s = state();
    const c = ctx(s);
    const fundsBefore = s.countries[1].stockpile.funds;
    const res = queueBuilding(c, 10, 'barracks', 1);
    expect(res.ok).toBe(true);
    expect(s.countries[1].stockpile.funds).toBe(fundsBefore - BUILDINGS.barracks.cost.funds!);
    expect(s.constructionQueues[10]).toHaveLength(1);
    expect(s.constructionQueues[10][0].ownerCountryId).toBe(1);
  });

  it('refuses a non-urban province', () => {
    const s = state();
    const res = queueBuilding(ctx(s, false), 10, 'barracks', 1);
    expect(res.ok).toBe(false);
    expect(s.constructionQueues[10]).toBeUndefined();
  });

  it('refuses a second copy of a building already built or queued', () => {
    const s = state();
    const c = ctx(s);
    expect(queueBuilding(c, 10, 'barracks', 1).ok).toBe(true);
    expect(queueBuilding(c, 10, 'barracks', 1).ok).toBe(false); // already queued
    s.provinceBuildings[10] = { barracks: 1, tankPlant: 0, ordnance: 0, missileSite: 0 };
    s.constructionQueues = {};
    expect(queueBuilding(c, 10, 'barracks', 1).ok).toBe(false); // already built
  });

  it('refuses a country that cannot afford it', () => {
    const s = state();
    s.countries[1].stockpile.metal = 0;
    const res = queueBuilding(ctx(s), 10, 'tankPlant', 1); // tankPlant needs metal
    expect(res.ok).toBe(false);
  });
});

describe('stepConstruction', () => {
  it('completes after totalHours and unlocks the unit line', () => {
    const s = state();
    const c = ctx(s);
    queueBuilding(c, 10, 'barracks', 1);
    expect(producibleUnits(c, 10, 1)).not.toContain('infantry'); // no barracks yet

    const total = BUILDINGS.barracks.buildTimeHours;
    stepConstruction(c, total * 0.5);
    expect(s.provinceBuildings[10]?.barracks ?? 0).toBe(0); // not done
    const done = stepConstruction(c, total * 0.5);
    expect(done).toEqual([{ provinceId: 10, buildingId: 'barracks', ownerCountryId: 1 }]);
    expect(s.provinceBuildings[10].barracks).toBe(1);
    expect(s.constructionQueues[10]).toBeUndefined();
    expect(producibleUnits(c, 10, 1)).toContain('infantry'); // unlocked
  });

  it('voids the order when the province is captured mid-build', () => {
    const s = state();
    const c = ctx(s);
    queueBuilding(c, 10, 'barracks', 1);
    s.provinceOwners[10] = 2; // captured
    const done = stepConstruction(c, 999);
    expect(done).toHaveLength(0);
    expect(s.provinceBuildings[10]?.barracks ?? 0).toBe(0);
    expect(s.constructionQueues[10]).toBeUndefined();
  });
});

describe('buildableBuildings', () => {
  it('lists the four buildings for an owned urban province, none once built', () => {
    const s = state();
    const c = ctx(s);
    expect(buildableBuildings(c, 10, 1).sort()).toEqual(['barracks', 'missileSite', 'ordnance', 'tankPlant']);
    s.provinceBuildings[10] = { barracks: 1, tankPlant: 1, ordnance: 1, missileSite: 1 };
    expect(buildableBuildings(c, 10, 1)).toEqual([]);
  });

  it('is empty for a province the country does not own', () => {
    const s = state();
    expect(buildableBuildings(ctx(s), 10, 2)).toEqual([]);
  });
});

describe('buildOptions', () => {
  it('still offers a building the country cannot afford, flagged unaffordable', () => {
    const s = state();
    s.countries[1].stockpile = { ...emptyStockpile(), funds: 0, stone: 0, metal: 0 };
    const opts = buildOptions(ctx(s), 10, 1);
    expect(opts.map((o) => o.id).sort()).toEqual(['barracks', 'missileSite', 'ordnance', 'tankPlant']);
    expect(opts.every((o) => !o.affordable)).toBe(true);
    expect(buildableBuildings(ctx(s), 10, 1)).toEqual([]); // none actually startable
  });

  it('drops a building once it is built or queued', () => {
    const s = state();
    const c = ctx(s);
    queueBuilding(c, 10, 'barracks', 1);
    expect(buildOptions(c, 10, 1).map((o) => o.id).sort()).toEqual(['missileSite', 'ordnance', 'tankPlant']);
  });

  it('is empty for a rural province', () => {
    expect(buildOptions(ctx(state(), false), 10, 1)).toEqual([]);
  });
});
