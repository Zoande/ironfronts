import type { SimContext } from '../sim-context';
import type { ArmyStack } from '../units/army';
import { stackBaseSpeed } from '../units/army';
import { TERRAIN_CLASS } from '../world-data';
import { wrappedDistance } from '../geometry';
import { OUT_OF_SUPPLY_SPEED_MULTIPLIER } from '../combat/constants';
import { GAME_PACE } from '../pacing';
import { relationOf } from '../game-state';
import type { LandGraph } from './graph';
import type { EdgeCost } from './pathfind';

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

function baseWorldUnitsPerGameHour(army: ArmyStack): number {
  return stackBaseSpeed(army) * STRATEGIC_MOVEMENT_SCALE
    * (army.status === 'retreating' ? GAME_PACE.movement.retreatMultiplier : 1)
    * (army.inSupply === false ? OUT_OF_SUPPLY_SPEED_MULTIPLIER : 1);
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

function seaSegmentHours(army: ArmyStack, distance: number): number {
  const speed = baseWorldUnitsPerGameHour(army) * ROAD_BONUS;
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
    ? seaSegmentHours(army, distance) + GAME_PACE.movement.navalDwellHours * 2
    : landSegmentHours(
      session, army, graph.nodeX[from], graph.nodeZ[from], graph.nodeX[to], graph.nodeZ[to],
      prospectiveWars,
    );
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
    hours += seaSegmentHours(army, wrappedDistance(
      army.x, army.z, session.graph.nodeX[crossing.toNodeId],
      session.graph.nodeZ[crossing.toNodeId], session.world.width,
    ));
    hours += GAME_PACE.movement.navalDwellHours;
    fromNode = crossing.toNodeId;
    fromX = session.graph.nodeX[fromNode];
    fromZ = session.graph.nodeZ[fromNode];
    if (order.path[0] === fromNode) pathIndex = 1;
  } else if (crossing && army.status === 'disembarking') {
    hours += Math.max(0, crossing.hoursRemaining);
  }
  for (; pathIndex < order.path.length; pathIndex += 1) {
    const to = order.path[pathIndex];
    const toX = session.graph.nodeX[to];
    const toZ = session.graph.nodeZ[to];
    if (seaEdge(session.graph, fromNode, to)) {
      hours += GAME_PACE.movement.navalDwellHours * 2;
      hours += seaSegmentHours(army, wrappedDistance(
        fromX, fromZ, toX, toZ, session.world.width,
      ));
    } else {
      hours += landSegmentHours(session, army, fromX, fromZ, toX, toZ);
    }
    fromNode = to;
    fromX = toX;
    fromZ = toZ;
  }
  return hours;
}

/** The currently traversed edge, expressed for network presentation. Keeping
 * this beside stepMovement ensures client ETA projection uses the exact same
 * terrain, road, retreat, and global movement multipliers as simulation. */
export function currentMovementLeg(session: SimContext, army: ArmyStack): CurrentMovementLeg | null {
  const order = army.order;
  if (!order?.path.length || army.status === 'engaged'
    || army.status === 'embarking' || army.status === 'disembarking') return null;
  const targetNode = order.path[0];
  const targetX = session.graph.nodeX[targetNode];
  const targetZ = session.graph.nodeZ[targetNode];
  const terrainScale = army.status === 'atSea'
    ? ROAD_BONUS
    : landMovementSpeedMultiplierAt(session, army.ownerCountryId, army.x, army.z);
  const worldUnitsPerGameHour = baseWorldUnitsPerGameHour(army) * terrainScale;
  return {
    targetX,
    targetZ,
    worldUnitsPerGameHour,
    distance: wrappedDistance(army.x, army.z, targetX, targetZ, session.world.width),
  };
}

