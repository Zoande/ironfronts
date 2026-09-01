import { describe, expect, it } from 'vitest';
import { MAX_SIM_SPEED, MIN_SIM_SPEED, clampSimSpeed } from '../../apps/game-server/src/timing';

describe('clampSimSpeed', () => {
  it('keeps in-range multipliers as-is, including 0 (paused)', () => {
    expect(clampSimSpeed(0)).toBe(0);
    expect(clampSimSpeed(1)).toBe(1);
    expect(clampSimSpeed(8)).toBe(8);
    expect(clampSimSpeed(32)).toBe(32);
  });

  it('clamps out-of-range requests to the bounds', () => {
    expect(clampSimSpeed(-5)).toBe(MIN_SIM_SPEED);
    expect(clampSimSpeed(9999)).toBe(MAX_SIM_SPEED);
  });

  it('falls back to 1 for a non-finite request', () => {
    expect(clampSimSpeed(Number.NaN)).toBe(1);
    expect(clampSimSpeed(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
