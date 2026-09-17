import { ROAD_MAX_GRADE, sampleHeight, unwrapNear, wrap } from './infrastructure/common.mjs';
import { buildCityPlans } from './infrastructure/city-plans.mjs';
import { buildMeshes } from './infrastructure/meshes.mjs';
import { assembleProvinceRoutes } from './infrastructure/province-routes.mjs';
import { buildFurniture, rasterRoadField } from './infrastructure/outputs.mjs';
import { adaptRoutesWithCache } from './infrastructure/route-cache.mjs';
import { auditRoute } from './infrastructure/route-audit.mjs';

function suppressIllegalCrossings(routes, worldWidth) {
  const cellSize = 6;
  const cellsX = Math.ceil(worldWidth / cellSize);
  const cells = new Map();
  const ordered = routes.filter((route) => !route.suppressed)
    .sort((a, b) => Number(a.gradeWarning) - Number(b.gradeWarning) || b.population - a.population || a.id - b.id);
  const connected = (a, b) => a.start === b.start || a.start === b.end || a.end === b.start || a.end === b.end;
  const cross = (ax, az, bx, bz, cx, cz, dx, dz) => {
    const denominator = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
    if (Math.abs(denominator) < 0.0001) return undefined;
    const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / denominator;
    const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / denominator;
    return t >= -0.001 && t <= 1.001 && u >= -0.001 && u <= 1.001 ? { t } : undefined;
  };
  const hidden = [];
  for (const route of ordered) {
    let conflict;
    for (let index = 0; index + 1 < route.points.length && !conflict; index += 1) {
      const a = route.points[index];
      const bx = unwrapNear(route.points[index + 1].x, a.x, worldWidth);
      const bz = route.points[index + 1].z;
      const midpointX = wrap((a.x + bx) * 0.5, worldWidth);
      const midpointZ = (a.z + bz) * 0.5;
      const cellX = Math.floor(midpointX / cellSize);
      const cellZ = Math.floor(midpointZ / cellSize);
      const heading = Math.atan2(bz - a.z, bx - a.x);
      for (let oz = -1; oz <= 1 && !conflict; oz += 1) {
        for (let ox = -1; ox <= 1 && !conflict; ox += 1) {
          const key = `${wrap(cellX + ox, cellsX)},${cellZ + oz}`;
          for (const candidate of cells.get(key) ?? []) {
            if (connected(route, candidate.route)) continue;
            const angle = Math.abs(Math.atan2(Math.sin(heading - candidate.heading), Math.cos(heading - candidate.heading)));
            if (Math.min(angle, Math.PI - angle) < 20 * Math.PI / 180) continue;
            const cx = unwrapNear(candidate.ax, a.x, worldWidth);
            const candidateBx = unwrapNear(candidate.bx, cx, worldWidth);
            const intersection = cross(a.x, a.z, bx, bz, cx, candidate.az, candidateBx, candidate.bz);
            if (!intersection) continue;
            conflict = { x: wrap(a.x + (bx - a.x) * intersection.t, worldWidth), z: a.z + (bz - a.z) * intersection.t,
              otherRoadId: candidate.route.id };
            break;
          }
        }
      }
    }
    if (conflict) {
      route.suppressed = true;
      route.hiddenReason = 'crossing';
      hidden.push({ route, ...conflict });
      continue;
    }
    for (let index = 0; index + 1 < route.points.length; index += 1) {
      const a = route.points[index];
      const bx = unwrapNear(route.points[index + 1].x, a.x, worldWidth);
      const bz = route.points[index + 1].z;
      const midpointX = wrap((a.x + bx) * 0.5, worldWidth);
      const midpointZ = (a.z + bz) * 0.5;
      const key = `${Math.floor(midpointX / cellSize)},${Math.floor(midpointZ / cellSize)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push({ route, ax: a.x, az: a.z, bx: wrap(bx, worldWidth), bz, heading: Math.atan2(bz - a.z, bx - a.x) });
    }
  }
  return hidden;
}

export function buildInfrastructure({
  borderData, connectionData, networkData, provinces, heights, landField,
  fieldWidth, fieldHeight, roadFieldWidth, roadFieldHeight, worldWidth, worldHeight,
}) {
  const assembled = assembleProvinceRoutes(borderData, connectionData, networkData, provinces, worldWidth);
  const context = { heights, landField, fieldWidth, fieldHeight, worldWidth, worldHeight };
  adaptRoutesWithCache(assembled.routes, context);
  const cityPlans = buildCityPlans(assembled.routes, assembled.nodes, provinces, worldWidth);
  const hiddenRoads = [];
  const gradeWarnings = [];

  for (const route of assembled.routes) {
    route.profile = route.points.map((point) => sampleHeight(heights, fieldWidth, fieldHeight, worldWidth, worldHeight, point.x, point.z));
    const result = auditRoute(route, context);
    route.maximumGrade = result.maximumGrade;
    if (result.maximumGrade > ROAD_MAX_GRADE + 0.015) {
      route.gradeWarning = true;
      const midpoint = route.points[Math.floor(route.points.length * 0.5)];
      gradeWarnings.push({ roadId: route.id, x: midpoint.x, z: midpoint.z,
        endpoints: [route.start, route.end], affectedConnections: route.segmentIds, maximumGrade: result.maximumGrade });
    }
    if (result.visible) continue;
    route.suppressed = true;
    route.hiddenReason = result.reason;
    hiddenRoads.push({ roadId: route.id, reason: result.reason, x: result.x, z: result.z,
      endpoints: [route.start, route.end], affectedConnections: route.segmentIds, maximumGrade: result.maximumGrade });
  }

  for (const conflict of suppressIllegalCrossings(assembled.routes, worldWidth)) {
    const { route } = conflict;
    hiddenRoads.push({ roadId: route.id, reason: 'crossing', x: conflict.x, z: conflict.z,
      endpoints: [route.start, route.end], affectedConnections: route.segmentIds,
      otherRoadId: conflict.otherRoadId, maximumGrade: route.maximumGrade });
  }

  const meshes = buildMeshes(assembled.routes, heights, landField, fieldWidth, fieldHeight, worldWidth, worldHeight);
  const roadRaster = rasterRoadField(assembled.routes, roadFieldWidth, roadFieldHeight, worldWidth, worldHeight,
    landField, fieldWidth, fieldHeight);
  const furniture = buildFurniture(assembled.routes, cityPlans, worldWidth);
  const hiddenByReason = hiddenRoads.reduce((counts, road) => ({ ...counts, [road.reason]: (counts[road.reason] ?? 0) + 1 }), {});
  const largestCity = [...provinces].filter((province) => province.terrain_type_id === 14)
    .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))[0];
  const visibleRoads = assembled.routes.filter((route) => !route.suppressed);
  const mountainRoad = [...visibleRoads].sort((a, b) => Math.max(...b.profile) - Math.max(...a.profile))[0];
  const steepRoad = [...visibleRoads].sort((a, b) => b.maximumGrade - a.maximumGrade)[0];
  const hiddenShowcase = hiddenRoads.find((road) => road.reason === 'water') ?? hiddenRoads[0];
  const midpoint = (road) => road.points[Math.floor(road.points.length * 0.5)];

  // Gameplay consumes the exact adapted centerlines used to build the visual
  // ribbon above, never the ribbon triangles themselves. Float32-normalising
  // before measuring makes each stored length match the serialized geometry.
  const sourceNodeIds = [...new Set(assembled.routes.flatMap((route) => [route.start, route.end]))]
    .sort((a, b) => a - b);
  const canonicalNodeBySource = new Map(sourceNodeIds.map((sourceId, id) => [sourceId, id]));
  const pointValues = [];
  const canonicalEdges = assembled.routes.map((route) => {
    const pointOffset = pointValues.length / 2;
    let length = 0;
    let previous;
    for (const raw of route.points) {
      const point = { x: Math.fround(wrap(raw.x, worldWidth)), z: Math.fround(raw.z) };
      if (previous) length += Math.hypot(unwrapNear(point.x, previous.x, worldWidth) - previous.x, point.z - previous.z);
      pointValues.push(point.x, point.z);
      previous = point;
    }
    return {
      id: route.id,
      from: canonicalNodeBySource.get(route.start),
      to: canonicalNodeBySource.get(route.end),
      length,
      pointOffset,
      pointCount: route.points.length,
      dotted: Boolean(route.suppressed),
    };
  });
  const endpointBySource = new Map();
  for (const route of assembled.routes) {
    endpointBySource.set(route.start, route.points[0]);
    endpointBySource.set(route.end, route.points.at(-1));
  }
  const canonicalNodes = sourceNodeIds.map((sourceId, id) => {
    // Every adapted route sharing an endpoint produces the same endpoint.
    // Taking that value (rather than the pre-adaptation source center) keeps
    // graph nodes byte-identical to the already-rendered road endpoints.
    const point = endpointBySource.get(sourceId);
    return { id, sourceNodeId: sourceId, x: Math.fround(wrap(point.x, worldWidth)), z: Math.fround(point.z) };
  });

  console.log(`Hidden physical roads: ${hiddenRoads.length} (${Object.entries(hiddenByReason).map(([reason, count]) => `${reason}=${count}`).join(', ') || 'none'})`);
  return {
    ...meshes,
    ...furniture,
    roadField: roadRaster.field,
    roadClearance: roadRaster.clearance,
    cityPlans,
    roadNetwork: { version: 1, nodes: canonicalNodes, edges: canonicalEdges },
    roadCenterlines: Float32Array.from(pointValues),
    roadReport: {
      version: 'direct-roads-v1',
      logicalRoads: assembled.routes.length,
      emittedRoads: visibleRoads.length,
      hiddenRoadCount: hiddenRoads.length,
      hiddenByReason,
      hiddenRoads,
      gradeWarnings: gradeWarnings.map((warning) => ({ ...warning, emitted: !assembled.routes[warning.roadId].suppressed })),
      unmappedLandSegments: assembled.unmappedLandSegments,
    },
    stats: {
      landSegments: assembled.landSegmentCount,
      logicalRoads: assembled.routes.length,
      emittedRoads: visibleRoads.length,
      hiddenRoads: hiddenRoads.length,
      hiddenWaterRoads: hiddenByReason.water ?? 0,
      hiddenCrossingRoads: hiddenByReason.crossing ?? 0,
      steepRoads: gradeWarnings.length,
      steepEmittedRoads: gradeWarnings.filter((warning) => !assembled.routes[warning.roadId].suppressed).length,
      unmappedLandSegments: assembled.unmappedLandSegments.length,
    },
    showcases: {
      urban: [largestCity.center_x, largestCity.center_y],
      mountain: mountainRoad ? [midpoint(mountainRoad).x, midpoint(mountainRoad).z] : [largestCity.center_x, largestCity.center_y],
      steepRoad: steepRoad ? [midpoint(steepRoad).x, midpoint(steepRoad).z] : [largestCity.center_x, largestCity.center_y],
      dirtRoad: visibleRoads[0] ? [midpoint(visibleRoads[0]).x, midpoint(visibleRoads[0]).z] : [largestCity.center_x, largestCity.center_y],
      hiddenConnection: hiddenShowcase ? [hiddenShowcase.x, hiddenShowcase.z] : [largestCity.center_x, largestCity.center_y],
      europe: [7_050, 1_900], lakeRoad: [7_600, 2_600], liangshan: [10_583, 2_990],
    },
  };
}
