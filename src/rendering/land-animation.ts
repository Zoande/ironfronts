import { LAND_FIRE_PERIODS, LAND_FIRE_PHASE } from '../shaders/land-animation-constants';
export { LAND_FIRE_PERIODS, LAND_FIRE_PHASE } from '../shaders/land-animation-constants';

export function nextLandShot(time: number, phase: number, kind: number): { cycle: number; at: number } {
  const period = LAND_FIRE_PERIODS[kind as 0 | 1 | 2 | 3] ?? 3;
  let cycle = Math.ceil(time / period + phase - LAND_FIRE_PHASE);
  // Every fourth rifle cycle is a deliberate reload, shared with the shader.
  if (kind === 0 && ((cycle % 4) + 4) % 4 === 3) cycle++;
  return { cycle, at: (cycle + LAND_FIRE_PHASE - phase) * period };
}

export function landStateForFlags(flags: number): number {
  if (flags & 16) return 6;
  if (flags & 2) return flags & 4 ? 2 : 1;
  return flags & 8 ? 3 : 0;
}

export function landMuzzlePosition(
  x: number, z: number, heading: number, socket: readonly number[], scale: number,
  pivot: readonly number[] = [0,0,0], hullHeading = heading,
): { x: number; z: number; height: number } {
  const right = (socket[0]-pivot[0]) * scale, forward = (socket[2]-pivot[2]) * scale;
  const px=pivot[0]*scale,pz=pivot[2]*scale;
  return { x: x + px*Math.cos(hullHeading)+pz*Math.sin(hullHeading) + right * Math.cos(heading) + forward * Math.sin(heading),
    z: z + px*Math.sin(hullHeading)-pz*Math.cos(hullHeading) + right * Math.sin(heading) - forward * Math.cos(heading), height: socket[1] * scale };
}
