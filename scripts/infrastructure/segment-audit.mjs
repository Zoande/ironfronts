import { sampleScalar, unwrapNear } from './common.mjs';

/**
 * Per-edge open-water audit for the movement graph.
 *
 * `assembleProvinceRoutes` maps each raw land connection segment onto the
 * nearest province-pair *route* by midpoint distance — a proximity heuristic —
 * then `auditRoute` suppresses whole routes for the *visual* mesh. Trusting
 * that to decide traversability both over-prunes mis-assigned land segments and
 * under-prunes water segments that happened to sit near a visible route. So
 * this audits every land connection segment directly.
 *
 * It flags a segment only when the **majority of its centreline runs over open
 * (province-zero) water** — an actual strait or sea hop. It deliberately does
 * not flag a segment that merely grazes a coastline: the land field is a
 * ~6.6 world-unit raster and point-sampling it along the shore throws frequent
 * false positives that would strand reachable mainland provinces (an earlier
 * "any lateral sample is water" rule flagged ~1000 segments and isolated ~740
 * nodes, many of them real province centres). Coastal near-misses stay a
 * visual concern for the physical-road suppression; this is only the
 * "a land army must never march across the sea" guardrail.
 *
 * Returns the set of indices into `connectionData.segments` to flag. Those
 * edges stay in `connections.f32` with their `medium` byte and the stride
 * untouched — only offset 5 is set — so `buildLandGraph` registers the
 * identical node sequence and every graph node id is preserved across the
 * rebuild; it just never links the flagged edge.
 */
const WATER_CENTRELINE_FRACTION = 0.5;

export function auditLandConnections(connectionData, context) {
  const { landField, fieldWidth, fieldHeight, worldWidth, worldHeight } = context;
  const suppressed = new Set();
  const segments = connectionData.segments;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.medium !== 'land') continue;
    const ax = segment.x1;
    const az = segment.y1;
    const bx = unwrapNear(segment.x2, ax, worldWidth);
    const bz = segment.y2;
    const dx = bx - ax;
    const dz = bz - az;
    const length = Math.max(0.001, Math.hypot(dx, dz));
    const steps = Math.max(2, Math.ceil(length));
    let waterSamples = 0;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      if (sampleScalar(landField, fieldWidth, fieldHeight, worldWidth, worldHeight,
        ax + dx * t, az + dz * t) < 0.5) {
        waterSamples += 1;
      }
    }
    if (waterSamples / (steps + 1) >= WATER_CENTRELINE_FRACTION) suppressed.add(index);
  }
  return suppressed;
}
