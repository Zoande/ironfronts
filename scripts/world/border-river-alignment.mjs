import { clamp, smoothstep, wrap } from './raster.mjs';

// Political border segments (`material/topology/logical_border_segments.json`)
// and river placement (`riverMask`, built from the authored waterway graph
// plus auto-detected narrow water gaps — see visual-rivers.mjs) are two
// independently-derived features of the same province topology: nothing
// upstream ever aligned them, so a border can run a short distance from a
// river that, visually, it obviously "should" follow. This nudges land
// border vertices that already pass close to a river onto it, without ever
// dragging a border any real distance toward one it wasn't already next to.
//
// CORE_RADIUS/SEARCH_RADIUS use the same "close enough to be the same spot"
// scale already established elsewhere in this codebase (COMBAT_SNAP and the
// army-stack merge radius are both 26 world units).
const CORE_RADIUS_WORLD = 9;
const SEARCH_RADIUS_WORLD = 26;
const SMOOTH_PASSES = 1;
const SMOOTH_NEIGHBOR_WEIGHT = 0.28;

function wrapDelta(from, to, worldWidth) {
  let delta = to - from;
  if (delta > worldWidth / 2) delta -= worldWidth;
  else if (delta < -worldWidth / 2) delta += worldWidth;
  return delta;
}

/** Buckets only the (sparse) river pixels, keyed by bucket cell, for a cheap
 *  bounded 3x3-bucket nearest-neighbour search instead of a full-field
 *  distance transform — border vertices are a tiny fraction of the grid. */
function buildRiverBuckets(riverMask, idWidth, idHeight, bucketPixels) {
  const bucketsX = Math.max(1, Math.ceil(idWidth / bucketPixels));
  const bucketsY = Math.max(1, Math.ceil(idHeight / bucketPixels));
  const buckets = new Map();
  for (let y = 0; y < idHeight; y += 1) {
    const rowBase = y * idWidth;
    const by = Math.floor(y / bucketPixels);
    for (let x = 0; x < idWidth; x += 1) {
      if (!riverMask[rowBase + x]) continue;
      const key = by * bucketsX + Math.floor(x / bucketPixels);
      let bucket = buckets.get(key);
      if (!bucket) { bucket = []; buckets.set(key, bucket); }
      bucket.push(x, y);
    }
  }
  return { buckets, bucketsX, bucketsY };
}

function nearestRiverPixel(spatialIndex, idWidth, px, py, searchRadiusPixels, bucketPixels) {
  const { buckets, bucketsX, bucketsY } = spatialIndex;
  const bx = Math.floor(px / bucketPixels);
  const by = Math.floor(py / bucketPixels);
  let bestDistSq = searchRadiusPixels * searchRadiusPixels;
  let bestX = -1;
  let bestY = -1;
  for (let oy = -1; oy <= 1; oy += 1) {
    const cy = by + oy;
    if (cy < 0 || cy >= bucketsY) continue;
    for (let ox = -1; ox <= 1; ox += 1) {
      const cx = wrap(bx + ox, bucketsX);
      const bucket = buckets.get(cy * bucketsX + cx);
      if (!bucket) continue;
      for (let i = 0; i < bucket.length; i += 2) {
        const rx = bucket[i];
        const ry = bucket[i + 1];
        const dx = wrapDelta(px, rx, idWidth);
        const dy = ry - py;
        const distSq = dx * dx + dy * dy;
        if (distSq < bestDistSq) { bestDistSq = distSq; bestX = rx; bestY = ry; }
      }
    }
  }
  return bestX < 0 ? null : { x: bestX, y: bestY, distance: Math.sqrt(bestDistSq) };
}

function smoothInteriorVertices(points, worldWidth) {
  if (points.length < 3) return points;
  const out = points.map((p) => [p[0], p[1]]);
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index];
    const prev = points[index - 1];
    const next = points[index + 1];
    const dPrev = wrapDelta(point[0], prev[0], worldWidth);
    const dNext = wrapDelta(point[0], next[0], worldWidth);
    out[index][0] = wrap(point[0] + (dPrev + dNext) * SMOOTH_NEIGHBOR_WEIGHT, worldWidth);
    out[index][1] = point[1] + (prev[1] - point[1] + next[1] - point[1]) * SMOOTH_NEIGHBOR_WEIGHT;
  }
  return out;
}

/**
 * Returns a new `borderData` with land-border segment coordinates nudged
 * toward nearby river pixels. Coastline segments are left untouched — a
 * coastline already runs along water by definition. Purely a rendering
 * adjustment: does not touch `provinceIds`, terrain, or any other baked
 * asset, so it cannot desync the border line from province ownership logic
 * (which never reads border segment geometry).
 */
export function alignBordersToRivers(borderData, riverMask, { idWidth, idHeight, worldWidth, worldHeight }) {
  const pixelSizeX = worldWidth / idWidth;
  const pixelSizeY = worldHeight / idHeight;
  const averagePixelSize = (pixelSizeX + pixelSizeY) * 0.5;
  const searchRadiusPixels = SEARCH_RADIUS_WORLD / averagePixelSize;
  const bucketPixels = Math.max(1, Math.ceil(searchRadiusPixels));
  const spatialIndex = buildRiverBuckets(riverMask, idWidth, idHeight, bucketPixels);

  let snappedVertices = 0;
  let totalVertices = 0;
  let maxSnapWorld = 0;
  const sampleSnaps = [];

  const segments = borderData.segments.map((segment) => {
    if (segment.boundary_kind === 'coastline' || !segment.coordinates?.length) return segment;

    let snapped = segment.coordinates.map(([x, y]) => {
      totalVertices += 1;
      const px = wrap(x / worldWidth * idWidth, idWidth);
      const py = clamp(y / worldHeight * idHeight, 0, idHeight - 1);
      const nearest = nearestRiverPixel(spatialIndex, idWidth, px, py, searchRadiusPixels, bucketPixels);
      if (!nearest) return [x, y];
      const distanceWorld = nearest.distance * averagePixelSize;
      if (distanceWorld >= SEARCH_RADIUS_WORLD) return [x, y];
      const weight = 1 - smoothstep(CORE_RADIUS_WORLD, SEARCH_RADIUS_WORLD, distanceWorld);
      if (weight <= 0.01) return [x, y];
      const targetX = nearest.x / idWidth * worldWidth;
      const targetY = nearest.y / idHeight * worldHeight;
      const dx = wrapDelta(x, targetX, worldWidth);
      const dy = targetY - y;
      const nx = wrap(x + dx * weight, worldWidth);
      const ny = clamp(y + dy * weight, 0, worldHeight - 1);
      snappedVertices += 1;
      const snapDistance = Math.hypot(dx * weight, dy * weight);
      maxSnapWorld = Math.max(maxSnapWorld, snapDistance);
      sampleSnaps.push({
        province: segment.province_name, neighbor: segment.neighbor_province_name,
        from: [Math.round(x), Math.round(y)], to: [Math.round(nx), Math.round(ny)],
        snapDistance: Math.round(snapDistance * 10) / 10, distanceToRiver: Math.round(distanceWorld * 10) / 10,
      });
      return [nx, ny];
    });

    for (let pass = 0; pass < SMOOTH_PASSES; pass += 1) snapped = smoothInteriorVertices(snapped, worldWidth);

    return { ...segment, coordinates: snapped };
  });

  sampleSnaps.sort((a, b) => b.snapDistance - a.snapDistance);

  return {
    ...borderData,
    segments,
    report: {
      totalVertices, snappedVertices,
      snappedFraction: totalVertices ? snappedVertices / totalVertices : 0,
      maxSnapWorld, coreRadiusWorld: CORE_RADIUS_WORLD, searchRadiusWorld: SEARCH_RADIUS_WORLD,
      largestSnaps: sampleSnaps.slice(0, 10),
    },
  };
}
