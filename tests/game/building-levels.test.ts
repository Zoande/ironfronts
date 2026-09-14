import { describe, expect, it } from 'vitest';
import { BUILDINGS, queueBuilding, stepConstruction } from '../../src/game/construction';
import {
  RESOURCE_TIER_ENGINEER_CAP, RESOURCE_TIER_ENGINEER_MULTIPLIER,
  RESOURCE_TIER_PASSIVE, maximumResourceTier,
} from '../../src/game/economy/resources';
import { UNIT_PRODUCTION_RATE_BY_LEVEL, unitProductionWorkRate } from '../../src/game/production';
import type { SimContext } from '../../src/game/sim-context';

function context(): SimContext {
  return {
    state: {
      countries: { 1: { phase: 3, technologies: { infantry: 8, resources: 8, training: 8, hybrid: 8, armored: 8 }, stockpile: { funds: 100_000, manpower: 0, food: 0, stone: 100_000, metal: 100_000, oil: 0 } } },
      provinceOwners: { 10: 1 },
      provinceBuildings: { 10: { barracks: 1, tankPlant: 1, ordnance: 1, missileSite: 1 } },
      provinceEconomies: { 10: { productionCapacity: 1 } },
      constructionQueues: {}, nextOrderId: 1,
    },
    world: { provinces: [{ id: 10, urban: true }] },
  } as unknown as SimContext;
}

describe('eight-level building framework', () => {
  it('gives every building eight increasingly expensive and slower levels', () => {
    for (const building of Object.values(BUILDINGS)) {
      expect(building.tiers).toHaveLength(8);
      for (let i = 1; i < 8; i += 1) {
        expect(building.tiers[i].work).toBeGreaterThan(building.tiers[i - 1].work);
        expect(Object.values(building.tiers[i].cost).reduce((a, b) => a + (b ?? 0), 0))
          .toBeGreaterThan(Object.values(building.tiers[i - 1].cost).reduce((a, b) => a + (b ?? 0), 0));
      }
      expect(building.tiers[4].work).toBeGreaterThanOrEqual(42);
      expect(building.tiers[4].work).toBeLessThanOrEqual(44);
    }
  });

  it('queues and completes the next military level', () => {
    const ctx = context();
    expect(queueBuilding(ctx, 10, 'barracks', 1).ok).toBe(true);
    expect(ctx.state.constructionQueues[10][0].targetTier).toBe(2);
    stepConstruction(ctx, BUILDINGS.barracks.tiers[1].work);
    expect(ctx.state.provinceBuildings[10].barracks).toBe(2);
  });

  it('accelerates unit work from level I through level VIII', () => {
    const ctx = context();
    expect(unitProductionWorkRate(ctx, 10, 'infantry')).toBe(UNIT_PRODUCTION_RATE_BY_LEVEL[1]);
    ctx.state.provinceBuildings[10].barracks = 8;
    expect(unitProductionWorkRate(ctx, 10, 'infantry')).toBe(UNIT_PRODUCTION_RATE_BY_LEVEL[8]);
  });

  it('scales rich resource sites through level VIII', () => {
    expect(maximumResourceTier('oilPump', 0.979)).toBe(7);
    expect(maximumResourceTier('oilPump', 0.98)).toBe(8);
    expect(RESOURCE_TIER_PASSIVE[8]).toBeGreaterThan(RESOURCE_TIER_PASSIVE[7]);
    expect(RESOURCE_TIER_ENGINEER_CAP[8]).toBeGreaterThan(RESOURCE_TIER_ENGINEER_CAP[7]);
    expect(RESOURCE_TIER_ENGINEER_MULTIPLIER[8]).toBeGreaterThan(RESOURCE_TIER_ENGINEER_MULTIPLIER[7]);
  });
});
