import { ID_HEIGHT, ID_WIDTH, SEED, WORLD_HEIGHT, WORLD_WIDTH } from './config.mjs';
import { clamp, wrap } from './raster.mjs';

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0xffffffff;
  };
}

function pointProvince(ids, x, y) {
  const px = wrap(Math.floor(x / WORLD_WIDTH * ID_WIDTH), ID_WIDTH);
  const py = clamp(Math.floor(y / WORLD_HEIGHT * ID_HEIGHT), 0, ID_HEIGHT - 1);
  return ids[py * ID_WIDTH + px];
}

// Local (unit-mesh) footprint half-extents per building archetype. The base box
// spans +/-0.5 in x and z; archetype 3 adds a wider ground skirt (see
// createBuildingArchetypeMesh). A small coastline setback is added for the two
// largest archetypes so they sit further back from the shore.
const ARCHETYPE_FOOTPRINT_HALF = {
  0: { x: 0.56, z: 0.56 }, 1: { x: 0.62, z: 0.56 }, 2: { x: 0.56, z: 0.56 },
  3: { x: 0.7, z: 0.5 }, 4: { x: 0.5, z: 0.5 },
};
const LARGE_ARCHETYPE_COAST_SETBACK = 3.0;
const SMALL_ARCHETYPE_COAST_SETBACK = 0.75;
// Province-id texel size in world units; the footprint is sampled at roughly
// half this spacing so no interior water texel can slip between samples.
const ID_TEXEL_WORLD = WORLD_WIDTH / ID_WIDTH;

// The center point is already validated against the province id. This adds a
// full-footprint check so buildings on narrow coastal provinces and islands
// cannot spill onto open water. Ocean and static-water lakes/canals are
// province 0; any footprint sample landing there (plus a small setback for the
// largest archetypes) rejects the building. Footprint samples that merely cross
// into an adjacent *land* province are left alone - that is normal for a city
// built against its border.
function footprintClearsWater(provinceIds, x, y, angle, archetype, sx, sz) {
  const half = ARCHETYPE_FOOTPRINT_HALF[archetype] ?? ARCHETYPE_FOOTPRINT_HALF[0];
  const setback = archetype === 3 || archetype === 4
    ? LARGE_ARCHETYPE_COAST_SETBACK : SMALL_ARCHETYPE_COAST_SETBACK;
  const halfX = sx * half.x + setback;
  const halfZ = sz * half.z + setback;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const stepsX = Math.max(1, Math.ceil(halfX / (ID_TEXEL_WORLD * 0.5)));
  const stepsZ = Math.max(1, Math.ceil(halfZ / (ID_TEXEL_WORLD * 0.5)));
  for (let ix = -stepsX; ix <= stepsX; ix += 1) {
    const localX = (ix / stepsX) * halfX;
    for (let iz = -stepsZ; iz <= stepsZ; iz += 1) {
      const localZ = (iz / stepsZ) * halfZ;
      const worldX = x + localX * cos - localZ * sin;
      const worldY = y + localX * sin + localZ * cos;
      if (pointProvince(provinceIds, worldX, worldY) === 0) return false;
    }
  }
  return true;
}

function pickTreeVariant(rng, visual, isPlain) {
  const roll = rng();
  if (isPlain) {
    if (visual === 'Boreal') return roll < 0.58 ? 2 : roll < 0.80 ? 1 : 4;
    return roll < 0.42 ? 0 : roll < 0.68 ? 1 : roll < 0.86 ? 4 : 3;
  }
  if (visual === 'Jungle') return roll < 0.44 ? 3 : roll < 0.70 ? 0 : roll < 0.88 ? 1 : 4;
  if (visual === 'Boreal' || visual === 'Tundra') return roll < 0.68 ? 2 : roll < 0.84 ? 1 : roll < 0.94 ? 4 : 0;
  return roll < 0.36 ? 0 : roll < 0.56 ? 1 : roll < 0.72 ? 2 : roll < 0.87 ? 3 : 4;
}

function pickTreePalette(rng, visual, isPlain) {
  if (isPlain) return 0;
  if (visual === 'Boreal' || visual === 'Tundra') return rng() < 0.76 ? 1 : 0;
  if (visual === 'Jungle') return rng() < 0.56 ? 1 : 0;
  return rng() < 0.48 ? 1 : 0;
}

export function buildInstances(provinces, geometryById, provinceIds, areaCounts, roadClearance, cityPlans) {
  const trees = [];
  const buildings = [];
  let rejectedCoastalFootprints = 0;
  const coastalProvincesAffected = new Set();

  for (const province of provinces) {
    const geometry = geometryById.get(province.province_id);
    if (!geometry) continue;
    const allPoints = geometry.components.flat();
    const minX = Math.min(...allPoints.map((point) => point[0]));
    const maxX = Math.max(...allPoints.map((point) => point[0]));
    const minY = Math.min(...allPoints.map((point) => point[1]));
    const maxY = Math.max(...allPoints.map((point) => point[1]));
    const rng = makeRng(SEED ^ Math.imul(province.province_id + 1, 0x9e3779b1));
    const encodedId = province.province_id + 1;
    const area = areaCounts[encodedId] ?? 0;
    const visual = province.visual_terrain_tag ?? '';
    const isForest = province.terrain_type_id === 13;
    const isPlain = province.terrain_type_id === 10;
    const supportsPlainTrees = isPlain && visual !== 'Desert' && visual !== 'Sand Dunes' && visual !== 'Tundra';
    const supportsTrees = isForest || visual === 'Jungle' || visual === 'Boreal' || supportsPlainTrees;

    if (supportsTrees) {
      const target = isPlain
        ? clamp(Math.round(area / 95), 0, 12)
        : clamp(Math.round(area / 11 * (isForest ? 1 : 0.35)), 5, isForest ? 90 : 36);
      let placed = 0;
      for (let attempt = 0; attempt < target * 14 && placed < target; attempt += 1) {
        const x = minX + (maxX - minX) * rng();
        const y = minY + (maxY - minY) * rng();
        if (pointProvince(provinceIds, x, y) !== encodedId) continue;
        const roadIndex = clamp(Math.floor(y / WORLD_HEIGHT * ID_HEIGHT), 0, ID_HEIGHT - 1) * ID_WIDTH
          + wrap(Math.floor(x / WORLD_WIDTH * ID_WIDTH), ID_WIDTH);
        if (roadClearance[roadIndex] > 20) continue;
        const variant = pickTreeVariant(rng, visual, isPlain);
        const palette = pickTreePalette(rng, visual, isPlain);
        trees.push(x, y, 0.72 + rng() * 0.72, variant, rng() * Math.PI * 2, 0.82 + rng() * 0.28, encodedId, palette);
        placed += 1;
      }
    }

    if (province.terrain_type_id !== 14) continue;
    const populationScale = Math.log10(Math.max(1_000, province.population ?? 1_000));
    // Keep map-scale towns readable while giving their street plans a little
    // more life. Small provinces (islands like Taiwan) still scale down hard.
    const areaFactor = clamp(Math.sqrt(area) / 24, 0.3, 1);
    const target = Math.max(3, Math.round(clamp(Math.round((populationScale - 3) * 11.2), 6, 34) * areaFactor));
    const plan = cityPlans.get(province.province_id);
    const radius = plan?.radius ?? clamp(Math.sqrt(Math.max(30, area)) * 1.7, 7, 30);
    const placedBuildings = [];
    for (let attempt = 0, placed = 0; attempt < target * 90 && placed < target; attempt += 1) {
      const street = plan?.streets[Math.floor(rng() * plan.streets.length)];
      let angle;
      let x;
      let y;
      let distance;
      if (street) {
        const t = 0.08 + rng() * 0.84;
        const dx = street.x2 - street.x1;
        const dy = street.z2 - street.z1;
        angle = Math.atan2(dy, dx);
        const side = rng() < 0.5 ? -1 : 1;
        const setback = 4.4 + rng() * Math.max(5.2, radius * 0.34);
        x = street.x1 + dx * t - Math.sin(angle) * side * setback;
        y = street.z1 + dy * t + Math.cos(angle) * side * setback;
        distance = Math.hypot(x - province.center_x, y - province.center_y);
      } else {
        angle = rng() * Math.PI * 2;
        distance = Math.sqrt(rng()) * radius;
        x = province.center_x + Math.cos(angle) * distance;
        y = province.center_y + Math.sin(angle) * distance * 0.72;
      }
      if (pointProvince(provinceIds, x, y) !== encodedId) continue;
      const roadIndex = clamp(Math.floor(y / WORLD_HEIGHT * ID_HEIGHT), 0, ID_HEIGHT - 1) * ID_WIDTH
        + wrap(Math.floor(x / WORLD_WIDTH * ID_WIDTH), ID_WIDTH);
      if (roadClearance[roadIndex] > 178) continue;
      const centerBias = 1 - distance / radius;
      let archetype;
      if (placed === 0 && populationScale > 5.35) archetype = 4;
      else if (rng() < 0.10) archetype = 3;
      else if (visual === 'Desert' || visual === 'Sand Dunes' || visual === 'Mediterranean') archetype = rng() < 0.72 ? 2 : 1;
      else archetype = rng() < 0.46 ? 0 : rng() < 0.72 ? 1 : 2;
      const sx = archetype === 3 ? 5.4 + rng() * 5.2 : 2.5 + rng() * 5.6;
      const sz = archetype === 3 ? 4.8 + rng() * 5.8 : 2.5 + rng() * 5.8;
      // Real gap between buildings instead of near-overlap, so the cluster
      // reads as spaced structures rather than one merged mass.
      if (placedBuildings.some((other) => Math.hypot(other.x - x, other.y - y) < (other.radius + Math.max(sx, sz)) * 0.62)) continue;
      if (!footprintClearsWater(provinceIds, x, y, angle, archetype, sx, sz)) {
        rejectedCoastalFootprints += 1;
        coastalProvincesAffected.add(province.province_id);
        continue;
      }
      let sy = 4.2 + rng() * 7.5 + Math.max(0, centerBias) * Math.max(0, populationScale - 4) * 3.6;
      if (archetype === 4) sy *= 1.55;
      if (archetype === 3) sy *= 0.68;
      const palette = visual === 'Desert' || visual === 'Sand Dunes' ? 1 : visual === 'Mediterranean' ? 2 : visual === 'Boreal' || visual === 'Tundra' ? 3 : 0;
      buildings.push(x, y, sx, sy, sz, angle + (rng() - 0.5) * 0.08, palette + 0.72 + rng() * 0.24, archetype);
      placedBuildings.push({ x, y, radius: Math.max(sx, sz) });
      placed += 1;
    }
  }

  return {
    trees: new Float32Array(trees),
    buildings: new Float32Array(buildings),
    audit: {
      rejectedCoastalFootprints,
      coastalProvincesAffected: coastalProvincesAffected.size,
    },
  };
}
