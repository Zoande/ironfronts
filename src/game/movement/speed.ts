import type { SimContext } from '../sim-context';
import type { ArmyStack } from '../units/army';
import { stackBaseSpeed } from '../units/army';
import { TERRAIN_CLASS } from '../world-data';
import { wrappedDistance } from '../geometry';
import { supplyEffectiveness } from '../combat/supply';
import { GAME_PACE } from '../pacing';
import { relationOf } from '../game-state';
import type { LandGraph } from './graph';
import { edgeIdBetween, edgePolyline, edgePositionFrom } from './graph';
import type { EdgeCost } from './pathfind';
import { activeTransportStats, countryTransportLevel, transportType } from '../naval/transport';

export const TERRAIN_SPEED: Record<number, number> = {
  [TERRAIN_CLASS.plain]: 1,
  [TERRAIN_CLASS.hill]: 0.72,
  [TERRAIN_CLASS.mountain]: 0.48,
  [TERRAIN_CLASS.forest]: 0.8,
  [TERRAIN_CLASS.urban]: 0.9,
};
export const ROAD_BONUS = GAME_PACE.movement.roadMultiplier;
/** Armies move at 70% of their normal terrain-adjusted speed in hostile land. */
export const ENEMY_LAND_SPEED_MULTIPLIER = 0.7;
const ROUTE_SAMPLE_DISTANCE = 18;
/**
 * Global pacing multiplier on how far a stack travels per simulation hour.
 * Tuned purely for feel (strategic movement across a country, not units
 * sliding across the map) — it scales every stack equally, so relative speeds,
 * terrain ordering (plain > hill > mountain) and the road bonus are unchanged.
 * Does NOT touch the simulation tick.
 */
export const STRATEGIC_MOVEMENT_SCALE = GAME_PACE.movement.scale;
export interface CurrentMovementLeg {
  readonly targetX: number;
  readonly targetZ: number;
  /** Effective distance travelled per game hour on the current terrain. */
  readonly worldUnitsPerGameHour: number;
  readonly distance: number;
}

function wrappedDeltaX(fromX: number, toX: number, width: number): number {
  let dx = toX - fromX;
  if (dx > width / 2) dx -= width;
  else if (dx < -width / 2) dx += width;
  return dx;
}

/** Terrain and diplomatic speed multiplier at one land position. Prospective
 * wars let the planner price a neutral fallback as hostile before confirmation. */
export function landMovementSpeedMultiplierAt(
  session: SimContext, countryId: number, x: number, z: number,
  prospectiveWars: ReadonlySet<number> = new Set(),
): number {
  const terrain = TERRAIN_SPEED[session.world.terrainClassAt(x, z)] ?? 0.9;
  const provinceId = session.world.provinceAt(x, z);
  const ownerId = provinceId >= 0 ? (session.state.provinceOwners[provinceId] ?? 0) : 0;
  const hostile = ownerId > 0 && ownerId !== countryId
    && (relationOf(session.state, countryId, ownerId) === 'war' || prospectiveWars.has(ownerId));
  return terrain * ROAD_BONUS * (hostile ? ENEMY_LAND_SPEED_MULTIPLIER : 1);
}

/** Consume a base-speed distance budget across terrain/ownership boundaries.
 * Probes are anchored to the road distance, independent of caller dt. Only
 * boundaries that change speed need a binary search; live tiny steps stay cheap.
 */
export function advanceLandRoad(
  session: SimContext, army: ArmyStack, edgeId: number, from: number,
  start: number, limit: number, budget: number,
): { distance: number; used: number } {
  const scaleAt = (distance: number): number => {
    const point = edgePositionFrom(session.graph, edgeId, from, distance);
    return landMovementSpeedMultiplierAt(session, army.ownerCountryId, point.x, point.z);
  };
  const initial = budget;
  let distance = 0;
  while (distance < limit - 1e-9 && budget > 1e-9) {
    const at = start + distance;
    const gridEnd = (Math.floor((at + 1e-7) / 0.5) + 1) * 0.5;
    let segment = Math.min(limit - distance, gridEnd - at);
    const scale = scaleAt(at + Math.min(segment / 2, 1e-7));
    const middle = segment / 2;
    const middleScale = scaleAt(at + middle);
    const endScale = scaleAt(at + Math.max(0, segment - 1e-7));
    if (middleScale !== scale || endScale !== scale) {
      let low = middleScale !== scale ? 0 : middle;
      let high = middleScale !== scale ? middle : segment;
      for (let i = 0; i < 24 && high - low > 1e-7; i++) {
        const mid = (low + high) / 2;
        if (scaleAt(at + mid) === scale) low = mid; else high = mid;
      }
      segment = Math.max(1e-7, high);
    }
    const advance = Math.min(segment, budget * scale);
    distance += advance;
    budget = Math.max(0, budget - advance / scale);
  }
  return { distance, used:initial - budget };
}

function baseWorldUnitsPerGameHour(army: ArmyStack): number {
  return stackBaseSpeed(army) * STRATEGIC_MOVEMENT_SCALE
    * (army.status === 'retreating' ? GAME_PACE.movement.retreatMultiplier : 1)
    * supplyEffectiveness(army);
}

/** Integrate terrain/ownership along a segment rather than looking only at its
 * first endpoint. This is shared by route weights and the full-route ETA. */
function landSegmentHours(
  session: SimContext, army: ArmyStack,
  fromX: number, fromZ: number, toX: number, toZ: number,
  prospectiveWars: ReadonlySet<number> = new Set(),
): number {
  const dx = wrappedDeltaX(fromX, toX, session.world.width);
  const dz = toZ - fromZ;
  const distance = Math.hypot(dx, dz);
  const baseSpeed = baseWorldUnitsPerGameHour(army);
  if (distance <= 1e-9) return 0;
  if (baseSpeed <= 0) return Infinity;
  const steps = Math.max(1, Math.ceil(distance / ROUTE_SAMPLE_DISTANCE));
  const stepDistance = distance / steps;
  let hours = 0;
  for (let i = 0; i < steps; i += 1) {
    const t = (i + 0.5) / steps;
    const x = ((fromX + dx * t) % session.world.width + session.world.width) % session.world.width;
    const z = fromZ + dz * t;
    hours += stepDistance / (baseSpeed * landMovementSpeedMultiplierAt(
      session, army.ownerCountryId, x, z, prospectiveWars,
    ));
  }
  return hours;
}

export function landRoadHours(
  session: SimContext, army: ArmyStack, graph: LandGraph, from: number, to: number,
  prospectiveWars: ReadonlySet<number> = new Set(), startDistance = 0, endDistance = Infinity,
): number {
  const edgeId = edgeIdBetween(graph, from, to);
  if (edgeId < 0) return Infinity;
  const points = edgePolyline(graph, edgeId, from, startDistance, endDistance);
  let hours = 0;
  for (let i = 1; i < points.length; i += 1) hours += landSegmentHours(
    session, army, points[i - 1].x, points[i - 1].z, points[i].x, points[i].z, prospectiveWars,
  );
  return hours;
}

function transportWorldUnitsPerGameHour(session: SimContext, army: ArmyStack): number {
  const active = activeTransportStats(army);
  const stats = active ?? transportType(countryTransportLevel(session.state.countries[army.ownerCountryId]));
  return stats.speed * STRATEGIC_MOVEMENT_SCALE;
}

function seaSegmentHours(session: SimContext, army: ArmyStack, distance: number): number {
  const speed = transportWorldUnitsPerGameHour(session, army);
  return speed > 0 ? distance / speed : Infinity;
}

function seaEdge(graph: LandGraph, from: number, to: number): boolean {
  return graph.seaAdjacency[from]?.includes(to) ?? false;
}

/** Per-edge fastest-time cost used by route searches. Sea links include both
 * port dwell phases so a short ferry is not treated as free compared with land. */
export function movementEdgeTravelCost(
  session: SimContext, army: ArmyStack, graph: LandGraph,
  prospectiveWars: ReadonlySet<number> = new Set(),
): EdgeCost {
  return (from, to, distance) => seaEdge(graph, from, to)
    ? seaSegmentHours(session, army, distance) + GAME_PACE.movement.navalDwellHours * 2
    : landRoadHours(session, army, graph, from, to, prospectiveWars);
}

/** Authoritative estimate for every remaining edge and naval dwell phase. */
export function remainingOrderTravelHours(session: SimContext, army: ArmyStack): number | null {
  const order = army.order;
  if (!order) return null;
  let hours = 0;
  let pathIndex = 0;
  let fromNode = army.graphNodeId;
  let fromX = army.x;
  let fromZ = army.z;
  const crossing = army.navalCrossing;
  if (crossing && (army.status === 'embarking' || army.status === 'atSea')) {
    if (army.status === 'embarking') hours += Math.max(0, crossing.hoursRemaining);
    const finalSeaLeg = crossing.fromNodeId === crossing.toNodeId
      && order.seaDestination && !crossing.returningToAnchor;
    hours += seaSegmentHours(session, army, wrappedDistance(
      army.x, army.z, finalSeaLeg ? order.seaDestination!.x : session.graph.nodeX[crossing.toNodeId],
      finalSeaLeg ? order.seaDestination!.z : session.graph.nodeZ[crossing.toNodeId], session.world.width,
    ));
    if (!finalSeaLeg && !order.seaDestination) hours += GAME_PACE.movement.navalDwellHours;
    fromNode = crossing.toNodeId;
    fromX = session.graph.nodeX[fromNode];
    fromZ = session.graph.nodeZ[fromNode];
    if (order.path[0] === fromNode) pathIndex = 1;
  } else if (crossing && army.status === 'disembarking') {
    hours += Math.max(0, crossing.hoursRemaining);
  }
  if (!crossing && pathIndex === 0 && army.edge && order.path.length) {
    const to = order.path[0];
    const edgeId = army.edge.edgeId ?? edgeIdBetween(session.graph, army.edge.from, army.edge.to);
    const edge = session.graph.edges[edgeId];
    if (edge) {
      const distanceFromArmyEdgeOrigin = army.edge.distanceAlongEdge ?? order.edgeProgress;
      const start = to === edge.to ? edge.from : edge.to;
      const startDistance = start === army.edge.from
        ? distanceFromArmyEdgeOrigin : edge.length - distanceFromArmyEdgeOrigin;
      const endDistance = order.path.length === 1 && order.roadDestination?.edgeId === edgeId
        ? (start === order.roadDestination.from
          ? order.roadDestination.distanceAlongEdge
          : edge.length - order.roadDestination.distanceAlongEdge) : Infinity;
      hours += landRoadHours(session, army, session.graph, start, to, new Set(), startDistance, endDistance);
      fromNode = to;
      fromX = session.graph.nodeX[to];
      fromZ = session.graph.nodeZ[to];
      pathIndex = 1;
    }
  }
  for (; pathIndex < order.path.length; pathIndex += 1) {
    const to = order.path[pathIndex];
    const toX = session.graph.nodeX[to];
    const toZ = session.graph.nodeZ[to];
    if (seaEdge(session.graph, fromNode, to)) {
      hours += GAME_PACE.movement.navalDwellHours * 2;
      hours += seaSegmentHours(session, army, wrappedDistance(
        fromX, fromZ, toX, toZ, session.world.width,
      ));
    } else {
      const edgeId = edgeIdBetween(session.graph, fromNode, to);
      const edge = session.graph.edges[edgeId];
      const endDistance = pathIndex === order.path.length - 1
        && order.roadDestination?.edgeId === edgeId && edge
        ? (fromNode === order.roadDestination.from
          ? order.roadDestination.distanceAlongEdge
          : edge.length - order.roadDestination.distanceAlongEdge) : Infinity;
      hours += landRoadHours(session, army, session.graph, fromNode, to, new Set(), 0, endDistance);
    }
    fromNode = to;
    fromX = toX;
    fromZ = toZ;
  }
  if (order.seaDestination && !(crossing && crossing.fromNodeId === crossing.toNodeId
    && !crossing.returningToAnchor)) {
    hours += seaSegmentHours(session, army, wrappedDistance(
      fromX, fromZ, order.seaDestination.x, order.seaDestination.z, session.world.width,
    ));
    if (!crossing) hours += GAME_PACE.movement.navalDwellHours;
  }
  return hours;
}

/** The currently traversed edge, expressed for network presentation. Keeping
 * this beside stepMovement ensures client ETA projection uses the exact same
 * terrain, road, retreat, and global movement multipliers as simulation. */
export function currentMovementLeg(session: SimContext, army: ArmyStack): CurrentMovementLeg | null {
  const order = army.order;
  if (!order || army.status === 'engaged'
    || army.status === 'embarking' || army.status === 'disembarking') return null;
  if (!order.path.length && !order.seaDestination && !army.navalCrossing?.returningToAnchor) return null;
  if (army.navalCrossing?.returningToAnchor) {
    const anchor = army.graphNodeId;
    return { targetX: session.graph.nodeX[anchor], targetZ: session.graph.nodeZ[anchor],
      worldUnitsPerGameHour: transportWorldUnitsPerGameHour(session, army),
      distance: wrappedDistance(army.x, army.z, session.graph.nodeX[anchor],
        session.graph.nodeZ[anchor], session.world.width) };
  }
  if (order.seaDestination && !order.path.length) {
    return { targetX: order.seaDestination.x, targetZ: order.seaDestination.z,
      worldUnitsPerGameHour: transportWorldUnitsPerGameHour(session, army),
      distance: wrappedDistance(army.x, army.z, order.seaDestination.x,
        order.seaDestination.z, session.world.width) };
  }
  const targetNode = order.path[0];
  const finalPartial = order.path.length === 1 && order.roadDestination?.to === targetNode;
  const destination = finalPartial
    ? edgePositionFrom(session.graph,order.roadDestination!.edgeId,order.roadDestination!.from,order.roadDestination!.distanceAlongEdge) : null;
  const targetX = destination?.x ?? session.graph.nodeX[targetNode];
  const targetZ = destination?.z ?? session.graph.nodeZ[targetNode];
  const worldUnitsPerGameHour = army.status === 'atSea'
    ? transportWorldUnitsPerGameHour(session, army)
    : baseWorldUnitsPerGameHour(army)
      * landMovementSpeedMultiplierAt(session, army.ownerCountryId, army.x, army.z);
  return {
    targetX,
    targetZ,
    worldUnitsPerGameHour,
    distance: army.edge
      ? (() => {
        const edgeId = army.edge!.edgeId ?? edgeIdBetween(session.graph, army.edge!.from, army.edge!.to);
        const length = session.graph.edges[edgeId]?.length ?? 0;
        const progress = army.edge!.distanceAlongEdge ?? order.edgeProgress;
        const destination = finalPartial && order.roadDestination?.edgeId === edgeId
          ? (army.edge!.from === order.roadDestination.from
            ? order.roadDestination.distanceAlongEdge
            : length - order.roadDestination.distanceAlongEdge) : null;
        return destination !== null ? Math.abs(destination - progress)
          : targetNode === army.edge!.to ? length - progress : progress;
      })()
      : (finalPartial ? order.roadDestination!.distanceAlongEdge
        : session.graph.edges[edgeIdBetween(session.graph, army.graphNodeId, targetNode)]?.length
        ?? wrappedDistance(army.x, army.z, targetX, targetZ, session.world.width)),
  };
}

