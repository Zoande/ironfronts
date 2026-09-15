export interface ProjectedMotionLeg {
  readonly targetX: number; readonly targetZ: number; readonly durationMs: number;
  readonly route?: ReadonlyArray<{ x: number; z: number }>;
  readonly sampledAtEpochMs?: number; readonly generation?: number;
}
export interface ArmyMotionSample {
  readonly x: number; readonly z: number; readonly targetX: number; readonly targetZ: number; readonly remainingMs: number;
}
interface Snapshot { x: number; z: number; at: number; motion: ProjectedMotionLeg }
const INTERPOLATION_DELAY_MS = 200;
const MAX_EXTRAPOLATION_MS = 500;
function unwrap(x: number, reference: number, width: number): number {
  return width > 0 ? reference + ((x - reference + width * 1.5) % width + width) % width - width / 2 : x;
}
function between(a: {x:number;z:number}, b: {x:number;z:number}, t: number) {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}
function verifiedPathToSample(a: Snapshot, b: Snapshot, width: number): Array<{x:number;z:number}> | null {
  const route = a.motion.route;
  if (!route?.length) return null;
  const points: Array<{x:number;z:number}> = [{ x:a.x, z:a.z }];
  for (const raw of route) {
    const previous = points[points.length - 1];
    const next = { x:unwrap(raw.x, previous.x, width), z:raw.z };
    if (Math.hypot(next.x-previous.x,next.z-previous.z) > 1e-6) points.push(next);
  }
  const end = { x:unwrap(b.x, a.x, width), z:b.z };
  let best: { index:number; t:number; error:number } | null = null;
  for (let index=0; index+1<points.length; index++) {
    const p=points[index], q=points[index+1];
    const dx=q.x-p.x, dz=q.z-p.z, lengthSq=dx*dx+dz*dz;
    const t=lengthSq ? Math.max(0,Math.min(1,((end.x-p.x)*dx+(end.z-p.z)*dz)/lengthSq)) : 0;
    const error=Math.hypot(end.x-(p.x+dx*t),end.z-(p.z+dz*t));
    if (!best || error<best.error) best={index,t,error};
  }
  if (!best || best.error>0.1) return null;
  return [...points.slice(0,best.index+1),end];
}
function interpolatePath(points: ReadonlyArray<{x:number;z:number}>, fraction: number, durationMs: number): ArmyMotionSample {
  const lengths=points.slice(1).map((point,index)=>Math.hypot(point.x-points[index].x,point.z-points[index].z));
  const total=lengths.reduce((sum,value)=>sum+value,0);
  let distance=total*Math.max(0,Math.min(1,fraction));
  for (let index=0; index<lengths.length; index++) {
    if (distance<=lengths[index] || index===lengths.length-1) {
      const point=between(points[index],points[index+1],distance/Math.max(1e-9,lengths[index]));
      return { ...point, targetX:points[index+1].x,targetZ:points[index+1].z,
        remainingMs:Math.max(0,(1-fraction)*durationMs) };
    }
    distance-=lengths[index];
  }
  const point=points[points.length-1];
  return { ...point,targetX:point.x,targetZ:point.z,remainingMs:0 };
}
/** Buffers authoritative samples. A crossed waypoint is retained in the
 * interpolation path; prediction never continues beyond a short freshness horizon. */
export class ArmyMotionInterpolator {
  private readonly tracks = new Map<string, Snapshot[]>();
  sample(armyId: string, x: number, z: number, motion: ProjectedMotionLeg | undefined,
    nowMs: number, worldWidth: number): ArmyMotionSample {
    if (!motion || !Number.isFinite(motion.durationMs) || motion.durationMs <= 0) {
      this.tracks.delete(armyId); return { x, z, targetX:x, targetZ:z, remainingMs:0 };
    }
    let history = this.tracks.get(armyId) ?? [];
    const last = history[history.length - 1];
    const changed = !last || last.x !== x || last.z !== z || last.motion.durationMs !== motion.durationMs
      || last.motion.targetX !== motion.targetX || last.motion.targetZ !== motion.targetZ;
    if (last && last.motion.generation !== motion.generation) history = [];
    if (changed || !history.length) {
      history.push({ x, z, motion, at: motion.sampledAtEpochMs ?? nowMs });
      if (history.length > 8) history.shift();
      this.tracks.set(armyId, history);
    }
    const newest = history[history.length - 1];
    const time = nowMs - INTERPOLATION_DELAY_MS;
    let a = history[0];
    for (const b of history.slice(1)) {
      if (time > b.at) { a = b; continue; }
      const end = { x: unwrap(b.x, a.x, worldWidth), z:b.z };
      const verifiedPath = verifiedPathToSample(a,b,worldWidth);
      const corner = { x: unwrap(a.motion.targetX, a.x, worldWidth), z:a.motion.targetZ };
      const before = Math.hypot(corner.x-a.x,corner.z-a.z);
      const after = Math.hypot(end.x-corner.x,end.z-corner.z);
      const speed = before / Math.max(1, a.motion.durationMs);
      const crossed = a.motion.targetX !== b.motion.targetX || a.motion.targetZ !== b.motion.targetZ;
      // A changed command cannot invent an old waypoint traversal. Only retain
      // a corner reachable at the previously announced speed in this interval.
      const viaCorner = crossed && before + after <= speed * Math.max(0, b.at-a.at) * 1.5 + 0.01;
      const t = Math.max(0,Math.min(1,(time-a.at)/Math.max(1,b.at-a.at)));
      if (verifiedPath) return interpolatePath(verifiedPath,t,b.at-a.at);
      let point, target, remainingMs;
      if (viaCorner && before + after > 0) {
        const distance = (before+after)*t;
        const first = distance < before;
        point = first ? between(a,corner,distance/Math.max(1e-9,before)) : between(corner,end,(distance-before)/Math.max(1e-9,after));
        target = first ? corner : end;
        remainingMs = (first ? before-distance : before+after-distance) / (before+after) * (b.at-a.at);
      } else if (crossed && Math.abs((end.x-a.x)*(corner.z-a.z)-(end.z-a.z)*(corner.x-a.x)) > 0.01) {
        // A reroute/correction supplies no verified intermediate road: snap to
        // that authoritative sample rather than fabricate diagonal travel.
        point=end; target=end; remainingMs=0;
      } else {
        point=between(a,end,t); target=end; remainingMs=(1-t)*(b.at-a.at);
      }
      return { ...point,targetX:target.x,targetZ:target.z,remainingMs:Math.max(0,remainingMs) };
    }
    const target = { x:unwrap(newest.motion.targetX,newest.x,worldWidth),z:newest.motion.targetZ };
    const age = Math.max(0,time-newest.at);
    const elapsed = Math.min(age,MAX_EXTRAPOLATION_MS,newest.motion.durationMs);
    const point = between(newest,target,elapsed/newest.motion.durationMs);
    const endTime = Math.min(MAX_EXTRAPOLATION_MS,newest.motion.durationMs);
    const boundedTarget = between(newest,target,endTime/newest.motion.durationMs);
    return { ...point,targetX:boundedTarget.x,targetZ:boundedTarget.z,remainingMs:Math.max(0,endTime-elapsed) };
  }
  retain(ids: ReadonlySet<string>): void { for (const id of this.tracks.keys()) if (!ids.has(id)) this.tracks.delete(id); }
  clear(): void { this.tracks.clear(); }
}

export interface ArmyPickEntry extends ArmyMotionSample { readonly id: string }
/** Matches the linear, bounded motion uploaded to the marker shader. */
export function presentedArmyPosition(entry: ArmyMotionSample, elapsedMs: number): { x:number; z:number } {
  const t = entry.remainingMs > 0 ? Math.max(0, Math.min(1, elapsedMs / entry.remainingMs)) : 0;
  return { x:entry.x + (entry.targetX-entry.x)*t, z:entry.z + (entry.targetZ-entry.z)*t };
}
