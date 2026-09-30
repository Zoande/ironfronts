import { describe, expect, it } from 'vitest';
import { fixture } from '../helpers/simulation';
import { terrainDefenseMultiplier } from '../../src/game/combat/terrain';
import { TERRAIN_CLASS } from '../../src/game/world-data';

describe('terrainDefenseMultiplier', () => {
  it('gives no bonus on plains and a real bonus on mountains', () => {
    const world = fixture().world;
    const plain = terrainDefenseMultiplier({ ...world, terrainClassAt: () => TERRAIN_CLASS.plain }, 0, 0);
    const mountain = terrainDefenseMultiplier({ ...world, terrainClassAt: () => TERRAIN_CLASS.mountain }, 0, 0);
    expect(plain).toBe(1);
    expect(mountain).toBeLessThan(plain);
  });
});

