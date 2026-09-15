import { describe, expect, it } from 'vitest';
import {
  advanceHour, calculateTimeOfDay, clampTimeMultiplier, formatClock, parseClock, stageForHour, wrapHour,
} from '../src/rendering/time-of-day';

describe('time of day', () => {
  it('wraps clock hours and advances a ten-minute day at the selected multiplier', () => {
    expect(wrapHour(25.5)).toBe(1.5);
    expect(wrapHour(-1)).toBe(23);
    expect(advanceHour(23, 50, 1)).toBeCloseTo(1);
    expect(advanceHour(8, 60, 0)).toBe(8);
  });

  it('clamps the debug multiplier to its advertised range', () => {
    expect(clampTimeMultiplier(-10)).toBe(0);
    expect(clampTimeMultiplier(500)).toBe(500);
    expect(clampTimeMultiplier(2_000)).toBe(999.9);
  });

  it('provides continuous daylight, twilight, and night lighting', () => {
    const midnight = calculateTimeOfDay(0);
    const dawn = calculateTimeOfDay(6);
    const noon = calculateTimeOfDay(12);
    expect(midnight.night).toBeGreaterThan(0.95);
    expect(dawn.twilight).toBeGreaterThan(0.5);
    expect(noon.daylight).toBeGreaterThan(0.95);
    expect(noon.sunDirection[1]).toBeGreaterThan(0.8);
  });

  it('formats, parses, and names useful debug clock positions', () => {
    expect(formatClock(6.5)).toBe('06:30');
    expect(formatClock(23.999)).toBe('00:00');
    expect(parseClock('18:45')).toBe(18.75);
    expect(parseClock('24:00')).toBeUndefined();
    expect(stageForHour(6)).toBe('Dawn');
    expect(stageForHour(18)).toBe('Sunset');
  });
});
