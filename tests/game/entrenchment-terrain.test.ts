import { describe, expect, it } from 'vitest';
import { fixture, army } from '../helpers/simulation';
import { stepEntrenchment, entrenchmentDamageMultiplier } from '../../src/game/combat/entrenchment';
import { terrainDefenseMultiplier } from '../../src/game/combat/terrain';
import { TERRAIN_CLASS } from '../../src/game/world-data';
import { ENTRENCHMENT_MAX } from '../../src/game/combat/constants';

describe('stepEntrenchment', () => {
  it('grows while idle, freezes while engaged, clears once moving', () => {
    const ctx = fixture();
    ctx.state.armies = {
      dugIn: { ...army('dugIn', 1), status: 'idle', entrenchment: 0 },
      holding: { ...army('holding', 1), status: 'engaged', entrenchment: 40 },
      marching: { ...army('marching', 1), status: 'moving', entrenchment: 40 },
    };
    stepEntrenchment(ctx, 1);
    expect(ctx.state.armies.dugIn.entrenchment!).toBeGreaterThan(0);
    expect(ctx.state.armies.holding.entrenchment).toBe(40);
    expect(ctx.state.armies.marching.entrenchment).toBe(0);
  });

  it('never exceeds the maximum', () => {
    const ctx = fixture();
    ctx.state.armies = { a: { ...army('a', 1), status: 'idle', entrenchment: 99 } };
    stepEntrenchment(ctx, 1000);
    expect(ctx.state.armies.a.entrenchment).toBe(ENTRENCHMENT_MAX);
  });
});

describe('entrenchmentDamageMultiplier', () => {
  it('is 1 at zero entrenchment and reduced (but never zero) at the cap', () => {
    expect(entrenchmentDamageMultiplier(0)).toBe(1);
    const atMax = entrenchmentDamageMultiplier(ENTRENCHMENT_MAX);
    expect(atMax).toBeLessThan(1);
    expect(atMax).toBeGreaterThan(0);
  });
});

describe('terrainDefenseMultiplier', () => {
  it('gives no bonus on plains and a real bonus on mountains', () => {
    const world = fixture().world;
    const plain = terrainDefenseMultiplier({ ...world, terrainClassAt: () => TERRAIN_CLASS.plain }, 0, 0);
    const mountain = terrainDefenseMultiplier({ ...world, terrainClassAt: () => TERRAIN_CLASS.mountain }, 0, 0);
    expect(plain).toBe(1);
    expect(mountain).toBeLessThan(plain);
  });
});

