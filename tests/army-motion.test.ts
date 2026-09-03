import { describe, expect, it } from 'vitest';
import { ArmyMotionInterpolator } from '../src/army-motion';

describe('army network motion interpolation', () => {
  it('continues toward the server waypoint for its remaining duration', () => {
    const motion = new ArmyMotionInterpolator();
    motion.sample('a', 0, 10, { targetX: 100, targetZ: 10, durationMs: 1_000 }, 0, 1_000);
    expect(motion.sample('a', 0, 10, { targetX: 100, targetZ: 10, durationMs: 1_000 }, 500, 1_000))
      .toMatchObject({ x: 50, z: 10, remainingMs: 500 });
  });

  it('rebases a correction from the displayed point without jumping', () => {
    const motion = new ArmyMotionInterpolator();
    motion.sample('a', 0, 0, { targetX: 100, targetZ: 0, durationMs: 1_000 }, 0, 1_000);
    const corrected = motion.sample('a', 45, 0, { targetX: 100, targetZ: 0, durationMs: 500 }, 400, 1_000);
    expect(corrected.x).toBeCloseTo(40);
    expect(motion.sample('a', 45, 0, { targetX: 100, targetZ: 0, durationMs: 500 }, 650, 1_000).x)
      .toBeCloseTo(70);
  });

  it('takes the short path across the wrapped world seam', () => {
    const motion = new ArmyMotionInterpolator();
    motion.sample('a', 990, 0, { targetX: 10, targetZ: 0, durationMs: 1_000 }, 0, 1_000);
    expect(motion.sample('a', 990, 0, { targetX: 10, targetZ: 0, durationMs: 1_000 }, 500, 1_000).x)
      .toBeCloseTo(1_000);
  });
});
