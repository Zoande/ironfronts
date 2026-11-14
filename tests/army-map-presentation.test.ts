import { describe, expect, it } from 'vitest';
import {
  buildArmyCompositionRows, buildArmyFormation, dominantVisualKind, visualKindForUnit, canPresentArtilleryFire,
} from '../src/rendering/army-map-presentation';

describe('army map presentation LOD data', () => {
  it('stops presenting bombardment when its source moves or its target leaves range/domain', () => {
    const source={x:990,z:0,status:'idle',artillery:{range:140}};
    const target={x:10,z:0,status:'idle',composition:{domain:'land'}};
    expect(canPresentArtilleryFire(source,target,1000)).toBe(true);
    expect(canPresentArtilleryFire(source,{...target,x:200},1000)).toBe(false);
    expect(canPresentArtilleryFire({...source,status:'moving'},target,1000)).toBe(false);
    expect(canPresentArtilleryFire(source,{...target,status:'atSea'},1000)).toBe(true);
    expect(canPresentArtilleryFire(source,{...target,composition:{domain:'naval'}},1000)).toBe(true);
  });
  it('maps infantry and armor families onto the compact counter silhouettes', () => {
    expect(visualKindForUnit('infantry')).toBe(0);
    expect(visualKindForUnit('engineer')).toBe(0);
    expect(visualKindForUnit('artillery')).toBe(0);
    expect(visualKindForUnit('armored-car')).toBe(2);
    expect(visualKindForUnit('light-tank')).toBe(2);
    expect(visualKindForUnit('medium-tank')).toBe(2);
  });

  it('combines counts and health by visual kind and finds the dominant kind', () => {
    const formation = buildArmyFormation([
      { typeId: 'infantry', count: 3, health: 1 },
      { typeId: 'engineer', count: 1, health: 0.5 },
      { typeId: 'light-tank', count: 2, health: 0.75 },
      { typeId: 'medium-tank', count: 1, health: 0.5 },
      { typeId: 'armored-car', count: 5, health: 0.8 },
    ]);
    expect(formation).toEqual([
      { kind: 0, count: 3, health: 1 },
      { kind: 1, count: 5, health: .8 },
      { kind: 2, count: 1, health: .5 },
      { kind: 6, count: 1, health: .5 },
      { kind: 8, count: 2, health: .75 },
    ]);
    expect(dominantVisualKind(buildArmyCompositionRows([
      { typeId: 'infantry', count: 3, health: 1 },
      { typeId: 'engineer', count: 1, health: 0.5 },
      { typeId: 'armored-car', count: 5, health: 0.8 },
    ]))).toBe(2);
  });

  it('represents every distinct family and respects tiny armies', () => {
    expect(buildArmyFormation([
      { typeId: 'infantry', count: 1, health: 1 },
      { typeId: 'artillery', count: 1, health: 1 },
    ])).toHaveLength(2);
    const mixed = buildArmyFormation([
      { typeId: 'infantry', count: 7, health: 1 },
      { typeId: 'armored-car', count: 2, health: 1 },
      { typeId: 'medium-tank', count: 1, health: 1 },
      { typeId: 'light-tank-l3', count: 3, health: 0.7 },
      { typeId: 'engineer', count: 2, health: 1 },
      { typeId: 'artillery', count: 1, health: 1 },
    ]);
    expect(mixed).toHaveLength(6);
    expect(new Set(mixed.map((slot) => slot.kind))).toEqual(new Set([0, 1, 2, 3, 6, 8]));
  });

  it('uses distinct models for the full land and naval rosters', () => {
    const groups = (ids:string[]) => ids.map(typeId=>({typeId,count:1,health:1}));
    expect(new Set(buildArmyFormation(groups(['infantry','engineer','militia','armored-car','light-tank','medium-tank','artillery'])).map(model=>model.kind)).size).toBe(7);
    expect(buildArmyFormation(groups(['battleship','destroyer','submarine'])).map(model=>model.kind)).toEqual(expect.arrayContaining([9,10,11]));
    expect(visualKindForUnit('submarine-l8')).toBe(5);
  });

  it('builds one compact marker row per shared icon family, largest first', () => {
    expect(buildArmyCompositionRows([
      { typeId: 'infantry', count: 3, health: 1 },
      { typeId: 'engineer', count: 2, health: 0.5 },
      { typeId: 'armored-car', count: 4, health: 0.75 },
      { typeId: 'light-tank', count: 1, health: 1 },
      { typeId: 'medium-tank', count: 2, health: 0.25 },
      { typeId: 'artillery', count: 6, health: 0.5 },
    ])).toEqual([
      { kind: 0, count: 11, health: (3 + 2 * 0.5 + 6 * 0.5) / 11 },
      { kind: 2, count: 7, health: (4 * 0.75 + 1 + 2 * 0.25) / 7 },
    ]);
  });
});
