import { describe, expect, it } from 'vitest';
import { ArmyMotionInterpolator, presentedArmyPosition } from '../src/rendering/army-motion';
import { ArmyPicker } from '../src/client/army-picker';
describe('bounded authoritative army presentation', () => {
  it('buffers samples and freezes prediction after half a second', () => {
    const motion = new ArmyMotionInterpolator();
    const leg = {targetX:100,targetZ:0,durationMs:1000,sampledAtEpochMs:0};
    expect(motion.sample('a',0,0,leg,500,1000).x).toBeCloseTo(30);
    expect(motion.sample('a',0,0,leg,5000,1000)).toMatchObject({x:50,remainingMs:0});
  });
  it('follows a verified corner instead of cutting diagonally', () => {
    const motion = new ArmyMotionInterpolator();
    motion.sample('a',0,0,{targetX:100,targetZ:0,durationMs:1000,sampledAtEpochMs:0},0,1000);
    const leg={targetX:100,targetZ:100,durationMs:500,sampledAtEpochMs:1500};
    const before=motion.sample('a',100,50,leg,950,1000);
    expect(before.x).toBeCloseTo(75); expect(before.z).toBe(0);
    const after=motion.sample('a',100,50,leg,1450,1000);
    expect(after.x).toBe(100); expect(after.z).toBeCloseTo(25);
  });
  it('reconstructs every authoritative corner crossed between samples', () => {
    const motion = new ArmyMotionInterpolator();
    motion.sample('a', 0, 0, {
      targetX: 100, targetZ: 0, durationMs: 1000, sampledAtEpochMs: 0,
      route: [{ x: 0, z: 0 }, { x: 100, z: 0 }, { x: 100, z: 100 }, { x: 200, z: 100 }],
    }, 0, 1000);
    const next = { targetX: 200, targetZ: 200, durationMs: 500, sampledAtEpochMs: 1500,
      route: [{ x: 200, z: 100 }, { x: 200, z: 200 }] };
    const firstCorner = motion.sample('a', 200, 100, next, 700, 1000);
    expect(firstCorner.x).toBeCloseTo(100); expect(firstCorner.z).toBeCloseTo(0);
    const secondCorner = motion.sample('a', 200, 100, next, 1200, 1000);
    expect(secondCorner.x).toBeCloseTo(100); expect(secondCorner.z).toBeCloseTo(100);
  });
  it('uses the short wrapped edge and shares the marker trajectory with picking', () => {
    const motion=new ArmyMotionInterpolator();
    const point=motion.sample('a',990,0,{targetX:10,targetZ:0,durationMs:1000,sampledAtEpochMs:0},500,1000);
    expect(point.x).toBeCloseTo(996);
    expect(presentedArmyPosition(point,200).x).toBeCloseTo(1000);
    expect(presentedArmyPosition(point,5000).x).toBeCloseTo(1000);
  });
  it('snaps on stops, clock generation changes and missing tracks', () => {
    const motion=new ArmyMotionInterpolator();
    motion.sample('a',0,0,{targetX:100,targetZ:0,durationMs:1000,generation:0},0,1000);
    expect(motion.sample('a',20,0,undefined,500,1000)).toMatchObject({x:20,remainingMs:0});
    motion.clear();
    expect(motion.sample('a',200,0,{targetX:300,targetZ:0,durationMs:1000,generation:1},500,1000).x).toBe(200);
  });
  it('a pursuit repath that reverses target direction shows the real position, never a wild extrapolation', () => {
    // Mirrors src/game/movement/pursuit.ts's revalidateOrder: a chased target
    // moves and the chaser's whole path (and therefore targetX/targetZ) is
    // replaced, possibly to somewhere behind where it was just heading. The
    // interpolator must not invent a diagonal cut through unverified ground —
    // it should fall back to the exact authoritative sample.
    const motion = new ArmyMotionInterpolator();
    motion.sample('a', 0, 0, { targetX: 100, targetZ: 0, durationMs: 1000, sampledAtEpochMs: 0 }, 0, 1000);
    // Barely any time has passed (50ms) when the repath reverses the target
    // entirely — the worst case for "stutter".
    const reversed = motion.sample(
      'a', 5, 0, { targetX: -100, targetZ: 0, durationMs: 1000, sampledAtEpochMs: 50 }, 250, 1000,
    );
    // Whatever it shows, it must be the real reported position (5,0) — not a
    // point extrapolated past it in either the old or new direction.
    expect(reversed.x).toBeCloseTo(5);
    expect(reversed.z).toBeCloseTo(0);
  });

  it('interpolates correctly against real Date.now()-scale epoch timestamps', () => {
    // sample()'s `nowMs` argument must be on the same clock as
    // motion.sampledAtEpochMs (a server Date.now() value) — the caller in
    // main.ts once passed performance.now() instead, a page-load-relative
    // clock on a completely different scale. That silently clamped every
    // interpolation fraction to 0, so the marker only ever snapped to each
    // new sample instead of tweening toward it.
    const motion = new ArmyMotionInterpolator();
    const epoch = 1_789_300_000_000; // realistic Date.now() magnitude
    motion.sample('a', 0, 0, { targetX: 100, targetZ: 0, durationMs: 1000, sampledAtEpochMs: epoch }, epoch, 1000);
    const midway = motion.sample('a', 0, 0, { targetX: 100, targetZ: 0, durationMs: 1000, sampledAtEpochMs: epoch }, epoch + 500, 1000);
    expect(midway.x).toBeCloseTo(30);
    expect(midway.x).toBeGreaterThan(0);
  });

  it('uses the presented marker position for CPU picking', () => {
    const picker = new ArmyPicker();
    picker.update([{ id:'a',x:0,z:0,targetX:100,targetZ:0,remainingMs:1000 }],0);
    expect(picker.pick(50,0,5,1000,0.5)).toBe('a');
    expect(picker.pick(0,0,5,1000,0.5)).toBeNull();
  });
});
