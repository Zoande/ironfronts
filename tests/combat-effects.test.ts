import { describe, expect, it } from 'vitest';
import {
  CombatEffectPool, EFFECT_KIND, EFFECT_STRIDE, compassLabel, effectDensityForDistance,
} from '../src/combat-effects';

const CAM = { x: 0, z: 0 };

describe('CombatEffectPool lifecycle', () => {
  it('never exceeds capacity and reuses slots (ring buffer, no growth)', () => {
    const pool = new CombatEffectPool(32);
    for (let i = 0; i < 200; i += 1) pool.spawn(EFFECT_KIND.impact, i, 0, { now: 1_000 });
    expect(pool.liveTransients(1_000)).toBe(32);
    const { floats, count } = pool.collect(1_000, CAM, 100_000);
    expect(count).toBe(32);
    expect(floats.length).toBe(32 * EFFECT_STRIDE);
  });

  it('ages transients out by their lifetime', () => {
    const pool = new CombatEffectPool();
    pool.spawn(EFFECT_KIND.muzzleFlash, 0, 0, { now: 0, lifetimeMs: 100 });
    expect(pool.collect(50, CAM, 1e6).count).toBe(1);
    expect(pool.collect(120, CAM, 1e6).count).toBe(0);
  });

  it('packs age01 as normalised lifetime progress', () => {
    const pool = new CombatEffectPool();
    pool.spawn(EFFECT_KIND.explosion, 10, 20, { now: 0, lifetimeMs: 1_000 });
    const { floats } = pool.collect(250, CAM, 1e6);
    expect(floats[0]).toBe(10);
    expect(floats[1]).toBe(20);
    expect(floats[2]).toBe(EFFECT_KIND.explosion);
    expect(floats[3]).toBeCloseTo(0.25, 5);
  });

  it('distance-culls transients but keeps battle markers', () => {
    const pool = new CombatEffectPool();
    pool.spawn(EFFECT_KIND.impact, 9_000, 0, { now: 0 });
    pool.setBattle('b1', 9_000, 0, 1);
    const { count, floats } = pool.collect(0, CAM, 2_000);
    expect(count).toBe(1); // marker only; the far impact is culled
    expect(floats[2]).toBe(EFFECT_KIND.battleMarker);
  });

  it('writes battle markers first and respects the instance budget', () => {
    const pool = new CombatEffectPool(64);
    pool.setBattle('b1', 0, 0);
    pool.setBattle('b2', 10, 10);
    for (let i = 0; i < 20; i += 1) pool.spawn(EFFECT_KIND.tracer, 0, 0, { now: 0 });
    const { count, floats } = pool.collect(0, CAM, 1e6, 3);
    expect(count).toBe(3);
    expect(floats[2]).toBe(EFFECT_KIND.battleMarker);
    expect(floats[EFFECT_STRIDE + 2]).toBe(EFFECT_KIND.battleMarker);
  });

  it('syncBattles reconciles the live set (adds new, drops ended)', () => {
    const pool = new CombatEffectPool();
    pool.syncBattles([{ id: 'a', x: 0, z: 0 }, { id: 'b', x: 1, z: 1 }]);
    expect(pool.battleCount).toBe(2);
    pool.syncBattles([{ id: 'b', x: 1, z: 1 }, { id: 'c', x: 2, z: 2 }]);
    expect(pool.battleCount).toBe(2);
    const ids = new Set<number>();
    const { floats, count } = pool.collect(0, CAM, 999);
    for (let i = 0; i < count; i += 1) ids.add(floats[i * EFFECT_STRIDE]); // x doubles as a cheap id here
    expect(count).toBe(2);
  });

  it('spawnVolley emits a small, category-appropriate burst (strategic scale)', () => {
    const inf = new CombatEffectPool();
    inf.spawnVolley('infantry', 0, 0, 0, { now: 0 });
    const art = new CombatEffectPool();
    art.spawnVolley('artillery', 0, 0, 0, { now: 0 });
    // A handful, not hundreds.
    expect(inf.liveTransients(0)).toBeGreaterThanOrEqual(4);
    expect(inf.liveTransients(0)).toBeLessThan(16);
    expect(art.liveTransients(0)).toBeLessThan(12);
  });

  it('clear() drops everything', () => {
    const pool = new CombatEffectPool();
    pool.spawn(EFFECT_KIND.impact, 0, 0, { now: 0 });
    pool.setBattle('b', 0, 0);
    pool.clear();
    expect(pool.collect(0, CAM, 999).count).toBe(0);
  });
});

describe('effect LOD + compass helpers', () => {
  it('scales spawn density down with camera distance', () => {
    expect(effectDensityForDistance(1_000)).toBe(1);
    expect(effectDensityForDistance(6_000)).toBe(0);
    const mid = effectDensityForDistance(3_200);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it('labels attack bearings like the server (north is -z, east is +x)', () => {
    expect(compassLabel(0, -10)).toBe('N');
    expect(compassLabel(10, 0)).toBe('E');
    expect(compassLabel(0, 10)).toBe('S');
    expect(compassLabel(-10, 0)).toBe('W');
    expect(compassLabel(10, -10)).toBe('NE');
    expect(compassLabel(0, 0)).toBe('');
  });
});
