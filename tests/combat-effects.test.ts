import { describe, expect, it } from 'vitest';
import {
  CombatEffectPool, EFFECT_KIND, EFFECT_STRIDE, compassLabel, effectDensityForDistance,
} from '../src/rendering/combat-effects';
import {
  buildBattleAnchors, combatHuddleOffset, groupEngagedByFront,
  HUDDLE_MAX_PULL, HUDDLE_TARGET_RADIUS, type EngagedStackLike, type Point,
} from '../src/rendering/combat-huddle';

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

  it('does not count future-scheduled layers as live before their birth time', () => {
    const pool = new CombatEffectPool();
    pool.spawn(EFFECT_KIND.smoke, 0, 0, { now: 2_000, lifetimeMs: 1_000 });
    expect(pool.liveTransients(1_000)).toBe(0);
    expect(pool.collect(1_000, CAM, 999).count).toBe(0);
    expect(pool.liveTransients(2_100)).toBe(1);
  });

  it('spawnTankShot choreographs muzzle, travel, impact, debris and smoke without timers', () => {
    const pool = new CombatEffectPool(64);
    pool.spawnTankShot(0, 0, 60, 0, { now: 1_000 });

    const initial = pool.collect(1_000, CAM, 1e6);
    const initialKinds = Array.from({ length: initial.count },
      (_, i) => initial.floats[i * EFFECT_STRIDE + 2]);
    expect(initialKinds).toContain(EFFECT_KIND.muzzleFlash);
    expect(initialKinds).not.toContain(EFFECT_KIND.explosion);

    const impact = pool.collect(1_220, CAM, 1e6);
    const impactKinds = Array.from({ length: impact.count },
      (_, i) => impact.floats[i * EFFECT_STRIDE + 2]);
    expect(impactKinds).toContain(EFFECT_KIND.explosion);
    expect(impactKinds).toContain(EFFECT_KIND.impact);
    expect(impactKinds).toContain(EFFECT_KIND.debris);
    expect(impact.count).toBeLessThanOrEqual(24);
  });

  it('spawnArtilleryShot stays a bounded strategic effect, not a particle flood', () => {
    const pool = new CombatEffectPool(64);
    pool.spawnArtilleryShot(0, 0, 120, 0, { now: 0 });
    expect(pool.liveTransients(0)).toBeLessThan(8); // only launch layers are born immediately

    const impact = pool.collect(1_100, CAM, 1e6);
    const kinds = Array.from({ length: impact.count },
      (_, i) => impact.floats[i * EFFECT_STRIDE + 2]);
    expect(kinds).toContain(EFFECT_KIND.explosion);
    expect(kinds).toContain(EFFECT_KIND.debris);
    expect(impact.count).toBeLessThanOrEqual(32);
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

describe('combatHuddleOffset (render-only visual nudge)', () => {
  it('pulls a far-apart stack in toward its shared battle anchor, closing the gap to the target radius', () => {
    const self: Point = { x: 0, z: 0 };
    const anchor: Point = { x: 100, z: 0 };
    const offset = combatHuddleOffset(self, anchor);
    expect(offset.x).toBeGreaterThan(0); // pulled toward +x, where the anchor is
    expect(offset.z).toBeCloseTo(0);
    // The whole point of the huddle is that the RESULT reads as close, not
    // just that some offset was applied — assert the actual post-offset gap.
    const resultingDist = Math.hypot((self.x + offset.x) - anchor.x, (self.z + offset.z) - anchor.z);
    expect(resultingDist).toBeCloseTo(HUDDLE_TARGET_RADIUS, 5);
  });

  it('does not push an already-close stack away from its anchor', () => {
    const self: Point = { x: 0, z: 0 };
    const anchor: Point = { x: 10, z: 0 }; // well inside HUDDLE_TARGET_RADIUS
    expect(combatHuddleOffset(self, anchor)).toEqual({ x: 0, z: 0 });
  });

  it('the anchor stack itself (self === anchor) gets no offset', () => {
    const point: Point = { x: 42, z: -17 };
    expect(combatHuddleOffset(point, point)).toEqual({ x: 0, z: 0 });
  });

  it('caps the pull distance so a very far anchor cannot teleport the marker', () => {
    const self: Point = { x: 0, z: 0 };
    const anchor: Point = { x: 100_000, z: 0 };
    const offset = combatHuddleOffset(self, anchor);
    expect(offset.x).toBeCloseTo(HUDDLE_MAX_PULL, 5);
  });

  it('is a pure function: never mutates the points it reads', () => {
    const self: Point = { x: 0, z: 0 };
    const anchor: Point = { x: 30, z: 40 };
    const selfSnapshot = { ...self };
    const anchorSnapshot = { ...anchor };
    combatHuddleOffset(self, anchor);
    expect(self).toEqual(selfSnapshot);
    expect(anchor).toEqual(anchorSnapshot);
  });
});

describe('groupEngagedByFront', () => {
  it('groups two engaged stacks that report the same front id, centroid as the anchor', () => {
    // COMBAT_SNAP is 26 world units (src/game/combat/constants.ts) — this is
    // the separation two stacks can have the instant a front is created.
    const stacks: EngagedStackLike[] = [
      { id: 'a', x: 0, z: 0, ownerCountryId: 1, frontIds: ['front-1'] },
      { id: 'b', x: 26, z: 0, ownerCountryId: 2, frontIds: ['front-1'] },
    ];
    const clusters = groupEngagedByFront(stacks);
    expect(clusters.size).toBe(1);
    const cluster = clusters.get('front-1')!;
    expect(cluster.x).toBeCloseTo(13);
    expect(cluster.z).toBeCloseTo(0);
    expect(cluster.ownerCountryIds).toEqual(new Set([1, 2]));
    expect([...cluster.memberIds].sort()).toEqual(['a', 'b']);
  });

  it('ignores stacks with no front id (not engaged / not fully visible)', () => {
    const stacks: EngagedStackLike[] = [
      { id: 'a', x: 0, z: 0, ownerCountryId: 1, frontIds: [] },
    ];
    expect(groupEngagedByFront(stacks).size).toBe(0);
  });

  it('separates two different fronts even if their stacks happen to sit close together', () => {
    const stacks: EngagedStackLike[] = [
      { id: 'a', x: 0, z: 0, ownerCountryId: 1, frontIds: ['front-1'] },
      { id: 'b', x: 5, z: 0, ownerCountryId: 2, frontIds: ['front-2'] },
    ];
    expect(groupEngagedByFront(stacks).size).toBe(2);
  });

  it('joins EVERY front an army reports, so a two-front army never leaves either front a singleton', () => {
    // A stack fighting two directions at once reports both front ids; it must
    // not silently drop out of one just because it also joined the other.
    const stacks: EngagedStackLike[] = [
      { id: 'pivot', x: 0, z: 0, ownerCountryId: 1, frontIds: ['front-1', 'front-2'] },
      { id: 'enemyA', x: 10, z: 0, ownerCountryId: 2, frontIds: ['front-1'] },
      { id: 'enemyB', x: -10, z: 0, ownerCountryId: 3, frontIds: ['front-2'] },
    ];
    const clusters = groupEngagedByFront(stacks);
    expect(clusters.size).toBe(2);
    expect(clusters.get('front-1')!.ownerCountryIds).toEqual(new Set([1, 2]));
    expect(clusters.get('front-2')!.ownerCountryIds).toEqual(new Set([1, 3]));
    expect(clusters.get('front-1')!.memberIds).toContain('pivot');
    expect(clusters.get('front-2')!.memberIds).toContain('pivot');
  });

  it('single fully-visible member still forms a real cluster (own army vs. a fog-obscured enemy)', () => {
    // A front id only exists because the sim built a real two-sided fight —
    // the enemy simply isn't fully visible to this viewer, so only the
    // player's own army reports it. This must still be treated as a live fight.
    const stacks: EngagedStackLike[] = [
      { id: 'mine', x: 0, z: 0, ownerCountryId: 1, frontIds: ['front-1'] },
    ];
    const clusters = groupEngagedByFront(stacks);
    expect(clusters.size).toBe(1);
    expect(clusters.get('front-1')!.memberIds).toEqual(['mine']);
  });
});

describe('groupEngagedByFront + buildBattleAnchors + combatHuddleOffset end-to-end', () => {
  it('converges two hostile stacks on a real front to a tight, non-zero-crossing gap', () => {
    // A pair well outside the visual huddle radius but within HUDDLE_MAX_PULL
    // of their shared front — a plausible "far apart despite being engaged"
    // separation (reinforcements can join a front from an adjacent road node,
    // well beyond COMBAT_SNAP's 26u trigger range).
    const stacks: EngagedStackLike[] = [
      { id: 'a', x: -50, z: 0, ownerCountryId: 1, frontIds: ['front-1'] },
      { id: 'b', x: 50, z: 0, ownerCountryId: 2, frontIds: ['front-1'] },
    ];
    const anchors = buildBattleAnchors(groupEngagedByFront(stacks));
    expect(anchors.get('a')).toEqual(anchors.get('b'));
    const offsetA = combatHuddleOffset(stacks[0], anchors.get('a')!);
    const offsetB = combatHuddleOffset(stacks[1], anchors.get('b')!);
    const renderedA = { x: stacks[0].x + offsetA.x, z: stacks[0].z + offsetA.z };
    const renderedB = { x: stacks[1].x + offsetB.x, z: stacks[1].z + offsetB.z };
    const finalGap = Math.hypot(renderedA.x - renderedB.x, renderedA.z - renderedB.z);
    // Both sides pull to within HUDDLE_TARGET_RADIUS of the shared anchor, so
    // the resulting gap is exactly twice that — a clash, not two distant icons.
    expect(finalGap).toBeCloseTo(2 * HUDDLE_TARGET_RADIUS, 5);
    expect(finalGap).toBeLessThan(100); // the original 100u gap
  });

  it('still shrinks the gap (via HUDDLE_MAX_PULL) even for a pair far beyond the target radius', () => {
    const stacks: EngagedStackLike[] = [
      { id: 'a', x: -300, z: 0, ownerCountryId: 1, frontIds: ['front-1'] },
      { id: 'b', x: 300, z: 0, ownerCountryId: 2, frontIds: ['front-1'] },
    ];
    const anchors = buildBattleAnchors(groupEngagedByFront(stacks));
    const offsetA = combatHuddleOffset(stacks[0], anchors.get('a')!);
    const offsetB = combatHuddleOffset(stacks[1], anchors.get('b')!);
    const finalGap = Math.hypot(
      (stacks[0].x + offsetA.x) - (stacks[1].x + offsetB.x),
      (stacks[0].z + offsetA.z) - (stacks[1].z + offsetB.z),
    );
    expect(finalGap).toBeCloseTo(600 - 2 * HUDDLE_MAX_PULL, 5);
    expect(finalGap).toBeLessThan(600); // still meaningfully closer, even if not down to the target radius
  });

  it('never assigns an anchor to a stack not part of any front', () => {
    const stacks: EngagedStackLike[] = [
      { id: 'a', x: 0, z: 0, ownerCountryId: 1, frontIds: ['front-1'] },
      { id: 'b', x: 10, z: 0, ownerCountryId: 2, frontIds: ['front-1'] },
      { id: 'bystander', x: 500, z: 500, ownerCountryId: 3, frontIds: [] },
    ];
    const anchors = buildBattleAnchors(groupEngagedByFront(stacks));
    expect(anchors.has('bystander')).toBe(false);
  });
});


  it('culls transients and battle markers with the viewport visibility callback', () => {
    const pool = new CombatEffectPool(32);
    pool.spawn(EFFECT_KIND.explosion, 100, 100, { now: 1_000, lifetimeMs: 1_000 });
    pool.spawn(EFFECT_KIND.smoke, 900, 900, { now: 1_000, lifetimeMs: 1_000 });
    pool.setBattle('near', 110, 110);
    pool.setBattle('far', 910, 910);

    const visible = pool.collect(
      1_200,
      { x: 100, z: 100 },
      5_000,
      32,
      (x, z) => x < 500 && z < 500,
    );

    expect(visible.count).toBe(2);
    const kinds = [
      visible.floats[2],
      visible.floats[8 + 2],
    ];
    expect(kinds).toContain(EFFECT_KIND.battleMarker);
    expect(kinds).toContain(EFFECT_KIND.explosion);
  });
