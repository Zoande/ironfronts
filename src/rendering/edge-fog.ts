/** The widest uniform border fade that leaves every province center clear. */
export function safeEdgeFogWidth(
  width: number,
  height: number,
  provinceCenters: Iterable<readonly [number, number]>,
): number {
  let nearestCenter = Number.POSITIVE_INFINITY;
  for (const [x, z] of provinceCenters) {
    nearestCenter = Math.min(nearestCenter, x, width - x, z, height - z);
  }
  return Number.isFinite(nearestCenter) ? Math.max(0, nearestCenter) : 0;
}

export function edgeFogOpacity(x: number, z: number, width: number, height: number, fadeWidth: number): number {
  if (fadeWidth <= 0) return 0;
  const distance = Math.min(x, width - x, z, height - z);
  const t = Math.min(1, Math.max(0, distance / fadeWidth));
  return 1 - t * t * (3 - 2 * t);
}
