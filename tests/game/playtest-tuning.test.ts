import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SELECTABLE_START_STOCKPILE, MINOR_START_STOCKPILE,
} from '../../src/game/scenario-init';

const root = process.cwd();

/**
 * Playtest pass 1 balance tuning: leaner opening economy (#14) and slower
 * strategic movement (#8). Sandbox and per-unit relative speeds are untouched.
 */
describe('opening economy is lean but non-zero', () => {
  it('cuts the selectable start stockpile well below the old prototype values', () => {
    // Old prototype: funds 2000 / manpower 1500. New must be materially lower.
    expect(SELECTABLE_START_STOCKPILE.funds).toBeLessThan(1_000);
    expect(SELECTABLE_START_STOCKPILE.manpower).toBeLessThan(800);
    // ...but still a real, playable footing (every resource > 0).
    for (const [k, v] of Object.entries(SELECTABLE_START_STOCKPILE)) {
      expect(v, k).toBeGreaterThan(0);
    }
  });

  it('keeps minors poorer than selectables on every axis', () => {
    for (const k of Object.keys(SELECTABLE_START_STOCKPILE) as Array<keyof typeof SELECTABLE_START_STOCKPILE>) {
      expect(MINOR_START_STOCKPILE[k], k).toBeLessThan(SELECTABLE_START_STOCKPILE[k]);
      expect(MINOR_START_STOCKPILE[k], k).toBeGreaterThan(0);
    }
  });

  it('does not touch the sandbox stockpile', () => {
    const src = readFileSync(path.join(root, 'src/game/scenario-init.ts'), 'utf8');
    expect(src).toMatch(/SANDBOX_STOCKPILE\s*=\s*\{[^}]*99_999/);
  });
});

describe('strategic movement pacing', () => {
  const src = readFileSync(path.join(root, 'src/game/units/movement.ts'), 'utf8');

  it('applies a single global sub-1 pacing scale to the travel budget', () => {
    expect(src).toMatch(/const STRATEGIC_MOVEMENT_SCALE = 0?\.[0-9]+;/);
    const value = Number(src.match(/STRATEGIC_MOVEMENT_SCALE = (0?\.[0-9]+)/)![1]);
    expect(value).toBeGreaterThan(0.2);
    expect(value).toBeLessThan(1);
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
