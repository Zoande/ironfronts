import { describe, expect, it } from 'vitest';
import {
  aggregateTroopStat, armyActivityLabel, roundDisplayedHp, summarizeBattleFronts,
} from '../src/ui/army-presentation';

describe('selected army presentation', () => {
  it('describes authoritative activities in player-facing language', () => {
    expect(armyActivityLabel('idle', false, true)).toBe('Holding position');
    expect(armyActivityLabel('moving', false, true)).toBe('Moving to destination');
    expect(armyActivityLabel('extracting', false, true)).toBe('Extracting resources');
    expect(armyActivityLabel('engaged', false, true)).toBe('Engaged in combat');
    expect(armyActivityLabel('idle', true, true)).toBe('Awaiting destination');
    expect(armyActivityLabel('idle', true, false)).toBe('Holding position');
  });

  it('aggregates troop attack and defence from the public presentation catalog', () => {
    const catalog: Record<string, Record<string, unknown>> = {
      infantry: {
        attack: { soft: 8, light: 4.4, heavy: 2.4 },
        defense: { soft: 6, light: 3.3, heavy: 1.8 },
      },
      artillery: {
        attack: { soft: 29.9, light: 23.4, heavy: 32.5 },
        defense: { soft: 3, light: 2.7, heavy: 3.75 },
      },
    };
    const groups = [
      { typeId: 'infantry', count: 4 },
      { typeId: 'artillery', count: 2 },
    ];
    expect(aggregateTroopStat(groups, 'attack', (id) => catalog[id])).toEqual({
      soft: 91.8, light: 64.4, heavy: 74.6,
    });
    expect(aggregateTroopStat(groups, 'defense', (id) => catalog[id])).toEqual({
      soft: 30, light: 18.6, heavy: 14.7,
    });
    expect(aggregateTroopStat(undefined, 'attack', (id) => catalog[id])).toBeUndefined();
  });

  it('condenses any number of continuous fronts into two battle sides with health', () => {
    const summary = summarizeBattleFronts([
      {
        role: 'attack', friendlyHp: 80, friendlyBaselineHp: 100, enemyHp: 30, enemyBaselineHp: 60,
        reinforcementCount: 1, outgoingDamagePerGameHour: 12, incomingDamagePerGameHour: 5,
        friendlyCasualties: 20, enemyCasualties: 30, estimatedGameHours: 2.5, estimatedRealSeconds: 9_000,
        friendlyModifiers: { frontageUsed: 5, frontageLimit: 10, coordination: 0.45,
          organization: 0.8, stanceOutput: 1.25, supply: 1, protection: 1, terrain: 1, devastation: 1 },
      },
      {
        role: 'defense', friendlyHp: 40, friendlyBaselineHp: 50, enemyHp: 20, enemyBaselineHp: 40,
        reinforcementCount: 2, outgoingDamagePerGameHour: 8, incomingDamagePerGameHour: 7,
        friendlyCasualties: 10, enemyCasualties: 20, estimatedGameHours: 3, estimatedRealSeconds: 10_800,
        friendlyModifiers: { frontageUsed: 3, frontageLimit: 10, coordination: 0.6,
          organization: 1, stanceOutput: 1, supply: 0.6, protection: 0.8, terrain: 0.7, devastation: 0.4 },
      },
    ]);
    expect(summary).toEqual({
      role: 'mixed', frontCount: 2, reinforcementCount: 3,
      friendly: {
        hp: 120, baselineHp: 150, healthPercent: 80, organizationPercent: 90, damagePerGameHour: 20,
      },
      enemy: {
        hp: 50, baselineHp: 100, healthPercent: 50, organizationPercent: 0, damagePerGameHour: 12,
      },
      outgoingDamagePerGameHour: 20,
      incomingDamagePerGameHour: 12,
      friendlyCasualties: 30,
      enemyCasualties: 50,
      estimatedGameHours: 2.5,
      estimatedRealSeconds: 9_000,
      modifiers: ['Frontage 8 / 20', 'Coordination ×0.53', 'Organization ×0.90',
        'Stance output ×1.13', 'Supply ×0.80', 'Protection ×0.90',
        'Terrain ×0.85', 'Devastation ×0.70'],
    });
    expect(summarizeBattleFronts([])).toBeNull();
  });

  it('rounds fractional authoritative HP only for display', () => {
    expect(roundDisplayedHp(21.56666)).toBe(22);
    expect(roundDisplayedHp(21.4)).toBe(21);
  });

  it('uses icon-led armor damage columns with tooltip descriptions', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(
      new URL('../src/ui/army.ts', import.meta.url), 'utf8',
    ));
    expect(source).toContain("statHeading('Base damage per game hour'");
    expect(source).toContain("statHeading('Soft damage'");
    expect(source).toContain("statHeading('Light damage'");
    expect(source).toContain("statHeading('Heavy damage'");
  });
});
