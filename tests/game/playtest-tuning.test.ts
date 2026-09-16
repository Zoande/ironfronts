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
 * Playtest econ-rebalance pass: unit costs (funds/food, mainly) went up
 * sharply so a starting treasury can no longer insta-build an unlimited line
 * of infantry (#econ-rebalance). Stockpiles are re-derived against the new
 * costs, not just cut by a flat percentage — see scenario-init.ts.
 */
describe('opening economy is lean but non-zero', () => {
  const infantry = UNIT_TYPE_BY_ID.get('infantry')!;
  const lightTank = UNIT_TYPE_BY_ID.get('light-tank')!;
  const mediumTank = UNIT_TYPE_BY_ID.get('medium-tank')!;

  it('prices infantry as a real expense, not pocket change', () => {
    // Old prototype: 20 funds / 5 food. Must be materially higher so a
    // starting stockpile buys only a handful, not dozens.
    expect(infantry.cost.funds).toBeGreaterThanOrEqual(150);
    expect(infantry.cost.food).toBeGreaterThanOrEqual(75);
    // Manpower gate is left alone — the stockpile already makes it binding.
    expect(infantry.cost.manpower).toBe(40);
  });

  it('prices the base tank as a five-figure-relative commitment above infantry, with a preserved tier gap to medium tanks', () => {
    expect(lightTank.cost.funds!).toBeGreaterThanOrEqual(800);
    expect(lightTank.cost.food).toBeGreaterThanOrEqual(200);
    // Physical inputs (metal/oil) are untouched by the rebalance.
    expect(lightTank.cost.metal).toBe(70);
    expect(lightTank.cost.oil).toBe(35);

    expect(mediumTank.cost.funds!).toBeGreaterThan(lightTank.cost.funds!);
    expect(mediumTank.cost.food!).toBeGreaterThan(lightTank.cost.food!);
    expect(mediumTank.cost.metal).toBe(120);
    expect(mediumTank.cost.oil).toBe(60);
    // Roughly preserve the old ~1.8x light->medium funds tier gap.
    const tierGap = mediumTank.cost.funds! / lightTank.cost.funds!;
    expect(tierGap).toBeGreaterThan(1.4);
    expect(tierGap).toBeLessThan(2.2);
  });

  it('funds a fresh selectable country for a handful of infantry from its stockpile alone, not a horde', () => {
    const count = affordableCount(SELECTABLE_START_STOCKPILE, infantry.cost);
    expect(count).toBeGreaterThanOrEqual(2);
    expect(count).toBeLessThanOrEqual(4);
  });

  it('leaves a selectable country able to afford at most one light tank up front', () => {
    const count = affordableCount(SELECTABLE_START_STOCKPILE, lightTank.cost);
    expect(count).toBeLessThanOrEqual(1);
    // And nowhere near a medium tank straight away.
    expect(affordableCount(SELECTABLE_START_STOCKPILE, mediumTank.cost)).toBe(0);
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
