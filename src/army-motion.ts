export interface ProjectedMotionLeg {
  readonly targetX: number;
  readonly targetZ: number;
  readonly durationMs: number;
}

export interface ArmyMotionSample {
  readonly x: number;
  readonly z: number;
  readonly targetX: number;
  readonly targetZ: number;
  readonly remainingMs: number;
}

interface MotionTrack extends ArmyMotionSample {
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly sourceX: number;
  readonly sourceZ: number;
  readonly sourceDurationMs: number;
}

function unwrapNear(value: number, reference: number, period: number): number {
  if (period <= 0) return value;
  let result = value;
  while (result - reference > period / 2) result -= period;
  while (reference - result > period / 2) result += period;
  return result;
}

function sampleTrack(track: MotionTrack, nowMs: number): ArmyMotionSample {
  const elapsed = Math.max(0, nowMs - track.startedAtMs);
  const t = track.durationMs > 0 ? Math.min(1, elapsed / track.durationMs) : 1;
  return {
    x: track.x + (track.targetX - track.x) * t,
    z: track.z + (track.targetZ - track.z) * t,
    targetX: track.targetX,
    targetZ: track.targetZ,
    remainingMs: Math.max(0, track.durationMs - elapsed),
  };
}

/** Maintains continuous client-side tracks between authoritative movement
 * samples. New server samples rebase from the currently displayed point, so a
 * correction changes velocity toward the same waypoint without teleporting. */
export class ArmyMotionInterpolator {
  private readonly tracks = new Map<string, MotionTrack>();

  sample(
    armyId: string,
    authoritativeX: number,
    authoritativeZ: number,
    motion: ProjectedMotionLeg | undefined,
    nowMs: number,
    worldWidth: number,
  ): ArmyMotionSample {
    const existing = this.tracks.get(armyId);
    if (!motion || !Number.isFinite(motion.durationMs) || motion.durationMs <= 0) {
      this.tracks.delete(armyId);
      return {
        x: authoritativeX, z: authoritativeZ,
        targetX: authoritativeX, targetZ: authoritativeZ, remainingMs: 0,
      };
    }
    const unchanged = existing
      && existing.sourceX === authoritativeX
      && existing.sourceZ === authoritativeZ
      && existing.targetX === unwrapNear(motion.targetX, existing.x, worldWidth)
      && existing.targetZ === motion.targetZ
      && existing.sourceDurationMs === motion.durationMs;
    if (unchanged) return sampleTrack(existing, nowMs);

    const displayed = existing ? sampleTrack(existing, nowMs) : {
      x: authoritativeX,
      z: authoritativeZ,
      targetX: authoritativeX,
      targetZ: authoritativeZ,
      remainingMs: 0,
    };
    const startX = unwrapNear(displayed.x, authoritativeX, worldWidth);
    const targetX = unwrapNear(motion.targetX, startX, worldWidth);
    const durationMs = Math.max(16, motion.durationMs);
    const next: MotionTrack = {
      x: startX,
      z: displayed.z,
      targetX,
      targetZ: motion.targetZ,
      remainingMs: durationMs,
      startedAtMs: nowMs,
      durationMs,
      sourceX: authoritativeX,
      sourceZ: authoritativeZ,
      sourceDurationMs: motion.durationMs,
    };
    this.tracks.set(armyId, next);
    return sampleTrack(next, nowMs);
  }

  retain(activeArmyIds: ReadonlySet<string>): void {
    for (const id of this.tracks.keys()) if (!activeArmyIds.has(id)) this.tracks.delete(id);
  }

  clear(): void { this.tracks.clear(); }
}
