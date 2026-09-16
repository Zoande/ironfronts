import { WORLD_FOG_END_RATIO } from './world-fog';

export { WORLD_FOG_END_RATIO, WORLD_FOG_START_RATIO } from './world-fog';

export type FrustumPlanes = Float32Array;

/**
 * The renderer encodes the previous, current, and next horizontal world copy as
 * instance indices 0, 1, and 2. All three are cheap CPU candidates; the
 * frustum test decides which chunks are actually submitted to the GPU.
 */
export const WORLD_COPY_INDICES = [0, 1, 2] as const;

export function sphereIntersectsHorizontalWorldWindow(
  centerX: number,
  radius: number,
  targetX: number,
  worldWidth: number,
): boolean {
  return Math.abs(centerX - targetX) <= worldWidth * WORLD_FOG_END_RATIO + radius;
}

/** Extracts normalized planes from a column-major WebGPU (zero-to-one Z) view-projection matrix. */
export function extractFrustumPlanes(matrix: ArrayLike<number>, output = new Float32Array(24)): FrustumPlanes {
  setPlane(output, 0, matrix[3] + matrix[0], matrix[7] + matrix[4], matrix[11] + matrix[8], matrix[15] + matrix[12]);
  setPlane(output, 4, matrix[3] - matrix[0], matrix[7] - matrix[4], matrix[11] - matrix[8], matrix[15] - matrix[12]);
  setPlane(output, 8, matrix[3] + matrix[1], matrix[7] + matrix[5], matrix[11] + matrix[9], matrix[15] + matrix[13]);
  setPlane(output, 12, matrix[3] - matrix[1], matrix[7] - matrix[5], matrix[11] - matrix[9], matrix[15] - matrix[13]);
  // WebGPU's near clip plane is z >= 0, rather than OpenGL's z >= -w.
  setPlane(output, 16, matrix[2], matrix[6], matrix[10], matrix[14]);
  setPlane(output, 20, matrix[3] - matrix[2], matrix[7] - matrix[6], matrix[11] - matrix[10], matrix[15] - matrix[14]);
  return output;
}

/** Conservative sphere/frustum intersection. Touching a plane remains visible. */
export function sphereIntersectsFrustum(
  planes: ArrayLike<number>,
  centerX: number,
  centerY: number,
  centerZ: number,
  radius: number,
): boolean {
  for (let offset = 0; offset < 24; offset += 4) {
    const distance = planes[offset] * centerX
      + planes[offset + 1] * centerY
      + planes[offset + 2] * centerZ
      + planes[offset + 3];
    if (distance < -radius) return false;
  }
  return true;
}

function setPlane(
  output: Float32Array,
  offset: number,
  x: number,
  y: number,
  z: number,
  distance: number,
): void {
  const inverseLength = 1 / Math.max(Number.EPSILON, Math.hypot(x, y, z));
  output[offset] = x * inverseLength;
  output[offset + 1] = y * inverseLength;
  output[offset + 2] = z * inverseLength;
  output[offset + 3] = distance * inverseLength;
}
