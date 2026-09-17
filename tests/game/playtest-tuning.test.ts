import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SELECTABLE_START_STOCKPILE, MINOR_START_STOCKPILE,
} from '../../src/game/scenario-init';
import { UNIT_TYPE_BY_ID } from '../../src/game/units/unit-catalog';
import type { ResourceCost } from '../../src/game/units/unit-types';

const root = process.cwd();

/** How many of `cost` a `stockpile` can pay for outright, floored. */
function affordableCount(
  stockpile: Record<string, number>, cost: ResourceCost,
): number {
  let max = Infinity;
  for (const [key, amount] of Object.entries(cost)) {
    if (!amount) continue;
    max = Math.min(max, Math.floor((stockpile[key] ?? 0) / amount));
  }
  return Number.isFinite(max) ? max : 0;
}

/**
 * Opening-economy contract for the current faster build-up: a selectable
 * country can raise a substantial infantry force immediately, while armor is
 * still constrained by funds, metal, and oil. Stockpiles are checked against
 * current unit costs so later tuning cannot silently change that opening.
 */
describe('opening economy supports an early build-up', () => {
  const infantry = UNIT_TYPE_BY_ID.get('infantry')!;
  const lightTank = UNIT_TYPE_BY_ID.get('light-tank')!;
  const mediumTank = UNIT_TYPE_BY_ID.get('medium-tank')!;

  it('prices infantry for a substantial but finite opening force', () => {
    expect(infantry.cost).toMatchObject({ funds: 350, manpower: 45, food: 35 });
  });

  it('prices armor through funds and strategic materials, with a preserved tier gap', () => {
    expect(lightTank.cost).toMatchObject({ funds: 1100, manpower: 30, metal: 140, oil: 55 });
    expect(lightTank.cost.food).toBeUndefined();

    expect(mediumTank.cost.funds!).toBeGreaterThan(lightTank.cost.funds!);
    expect(mediumTank.cost).toMatchObject({ funds: 2000, manpower: 45, metal: 260, oil: 110 });
    expect(mediumTank.cost.food).toBeUndefined();
    // Preserve the roughly 1.8x light-to-medium funds tier gap.
    const tierGap = mediumTank.cost.funds! / lightTank.cost.funds!;
    expect(tierGap).toBeGreaterThan(1.4);
    expect(tierGap).toBeLessThan(2.2);
  });

  it('funds eleven infantry from a fresh selectable stockpile', () => {
    const count = affordableCount(SELECTABLE_START_STOCKPILE, infantry.cost);
    expect(count).toBe(11);
  });

  it('funds three light tanks or one medium tank up front', () => {
    expect(affordableCount(SELECTABLE_START_STOCKPILE, lightTank.cost)).toBe(3);
    expect(affordableCount(SELECTABLE_START_STOCKPILE, mediumTank.cost)).toBe(1);
  });

  it('keeps every selectable-stockpile resource real and playable (never zero)', () => {
    for (const [k, v] of Object.entries(SELECTABLE_START_STOCKPILE)) {
      expect(v, k).toBeGreaterThan(0);
    }
  });

  it('keeps minors poorer than selectables on every axis, but still able to field infantry', () => {
    for (const k of Object.keys(SELECTABLE_START_STOCKPILE) as Array<keyof typeof SELECTABLE_START_STOCKPILE>) {
      expect(MINOR_START_STOCKPILE[k], k).toBeLessThan(SELECTABLE_START_STOCKPILE[k]);
      expect(MINOR_START_STOCKPILE[k], k).toBeGreaterThan(0);
    }
    expect(affordableCount(MINOR_START_STOCKPILE, infantry.cost)).toBeGreaterThanOrEqual(1);
  });

  it('does not touch the sandbox stockpile', () => {
    const src = readFileSync(path.join(root, 'src/game/scenario-init.ts'), 'utf8');
    expect(src).toMatch(/SANDBOX_STOCKPILE\s*=\s*\{[^}]*99_999/);
  });
});

describe('strategic movement pacing', () => {
  const src = ['src/game/movement/speed.ts','src/game/units/movement.ts'].map(file => readFileSync(path.join(root,file),'utf8')).join('\n');

  it('uses the centralized 1x pacing scale in the travel budget', () => {
    expect(src).toContain('STRATEGIC_MOVEMENT_SCALE = GAME_PACE.movement.scale');
    expect(src).toMatch(/budget = stackBaseSpeed\(army\) \* dtHours \* STRATEGIC_MOVEMENT_SCALE/);
  });

  it('leaves the terrain-speed ordering intact (plain > forest > hill > mountain)', () => {
    // TERRAIN_SPEED is a uniform multiplier applied after the pacing scale, so
    // the scale cannot reorder terrains. Guard the table's ordering directly.
    const table = src.slice(src.indexOf('TERRAIN_SPEED'), src.indexOf('ROAD_BONUS'));
    const plain = Number(table.match(/plain\]:\s*([0-9.]+)/)![1]);
    const forest = Number(table.match(/forest\]:\s*([0-9.]+)/)![1]);
    const hill = Number(table.match(/hill\]:\s*([0-9.]+)/)![1]);
    const mountain = Number(table.match(/mountain\]:\s*([0-9.]+)/)![1]);
    expect(plain).toBeGreaterThan(forest);
    expect(forest).toBeGreaterThan(hill);
    expect(hill).toBeGreaterThan(mountain);
  });
});
