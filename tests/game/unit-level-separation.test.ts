import { describe, expect, it } from 'vitest';
import { makeGroup, mergeStacks, type ArmyStack } from '../../src/game/units/army';

function stack(id: string, typeId: string): ArmyStack {
  return {
    id, ownerCountryId: 1, name: id, x: 0, z: 0, graphNodeId: 0,
    units: [makeGroup(typeId, 2)], status: 'idle', order: null, extractingNodeId: null,
  };
}

describe('unit level identity', () => {
  it('never merges different levels of the same unit family', () => {
    const target = stack('a', 'infantry');
    const source = stack('b', 'infantry-l2');
    mergeStacks(target, source);
    expect(target.units.map((group) => [group.typeId, group.count])).toEqual([
      ['infantry', 2], ['infantry-l2', 2],
    ]);
    expect(source.units).toEqual([]);
  });

  it('still pools groups with the exact same level id', () => {
    const target = stack('a', 'infantry-l2');
    const source = stack('b', 'infantry-l2');
    mergeStacks(target, source);
    expect(target.units).toHaveLength(1);
    expect(target.units[0].count).toBe(4);
  });
});
