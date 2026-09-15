import { describe, expect, it } from 'vitest';
import { ArmyPicker } from '../../src/client/army-picker';
import type { ArmyPickEntry } from '../../src/rendering/army-motion';

function stationary(id: string, x: number, z: number): ArmyPickEntry {
  return { id, x, z, targetX: x, targetZ: z, remainingMs: 0 };
}

describe('ArmyPicker', () => {
  it('pick() returns the nearest single stack within radius', () => {
    const picker = new ArmyPicker();
    picker.update([stationary('a', 100, 100), stationary('b', 5_000, 5_000)], 0);
    expect(picker.pick(100, 100, 40, 10_000, 0)).toBe('a');
    expect(picker.pick(9_000, 9_000, 40, 10_000, 0)).toBeNull();
  });

  it('pickAll() surfaces every co-located stack (both sides of a battle), nearest first', () => {
    const picker = new ArmyPicker();
    // A friendly and an enemy stack occupying the same node, as in an active battle.
    picker.update([stationary('enemy', 100, 100), stationary('friendly', 101, 100)], 0);
    const hits = picker.pickAll(100, 100, 40, 10_000, 0);
    expect(hits).toEqual(['enemy', 'friendly']);
  });

  it('pickAll() lets a repeat click cycle past the nearest stack to the one beneath it', () => {
    const picker = new ArmyPicker();
    picker.update([stationary('enemy', 100, 100), stationary('friendly', 101, 100)], 0);
    const selected = 'enemy';
    const other = picker.pickAll(100, 100, 40, 10_000, 0).find((id) => id !== selected);
    expect(other).toBe('friendly');
  });
});
