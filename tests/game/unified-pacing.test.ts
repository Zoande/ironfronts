import { describe, expect, it } from 'vitest';
import { GAME_PACE, UNIT_TYPES } from '../../packages/game-core/src/index';
import { ROAD_BONUS } from '../../src/game/movement/speed';
import { offlineSimulationHours } from '../../apps/game-server/src/timing';

describe('centralized multiweek pacing', () => {
  it('keeps all unit movement speeds in the shared 1x table', () => {
    for (const unit of UNIT_TYPES) {
      const family = unit.id.replace(/-l[2-8]$/, '') as keyof typeof GAME_PACE.movement.unitWorldUnitsPerHour;
      const level = Number(/-l([2-8])$/.exec(unit.id)?.[1] ?? 1);
      const expected = Math.round(GAME_PACE.movement.unitWorldUnitsPerHour[family]
        * (1 + (level - 1) * 0.025) * 100) / 100;
      expect(unit.speed).toBe(expected);
    }
    const infantryHoursAcrossTypicalProvince = 120
      / (GAME_PACE.movement.unitWorldUnitsPerHour.infantry * ROAD_BONUS);
    const armoredHoursAcrossTypicalProvince = 120
      / (GAME_PACE.movement.unitWorldUnitsPerHour['armored-car'] * ROAD_BONUS);
    expect(infantryHoursAcrossTypicalProvince).toBeGreaterThan(1);
    expect(infantryHoursAcrossTypicalProvince).toBeLessThan(1.5);
    const infantryMountainHours = infantryHoursAcrossTypicalProvince / 0.48;
    expect(infantryMountainHours).toBeGreaterThan(2.5);
    expect(infantryMountainHours).toBeLessThan(3.25);
    expect(armoredHoursAcrossTypicalProvince).toBeGreaterThan(0.5);
    expect(armoredHoursAcrossTypicalProvince).toBeLessThan(0.75);
  });

  it('replays downtime at real 1x and never runs backward', () => {
    expect(offlineSimulationHours(1_000, 7_201_000)).toBe(2);
    expect(offlineSimulationHours(10_000, 1_000)).toBe(0);
  });

  it('centralizes long strategic timers in real simulation hours', () => {
    expect(GAME_PACE.strategic.phase2FallbackHours).toBe(72);
    expect(GAME_PACE.strategic.phase3FallbackHours).toBe(168);
    expect(GAME_PACE.strategic.warheadHours).toBe(168);
    expect(GAME_PACE.strategic.devastationHours).toBe(144);
    expect(GAME_PACE.movement.navalDwellHours).toBe(0.5);
  });
});
