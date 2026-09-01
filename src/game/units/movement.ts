/** Ownership-aware army movement on the land road graph. */

import type { SimContext } from '../sim-context';
import type { ArmyStack, MoveOrder } from './army';
import { ensureArmyRuntimeState, stackBaseSpeed } from './army';
import {
  closestReachablePath, findPath, pathLength, type EdgeAllowed,
} from '../movement/pathfind';
import { nearestNode } from '../movement/graph';
import { wrappedDistance } from '../geometry';
import { TERRAIN_CLASS } from '../world-data';
import { relationOf, setRelation } from '../game-state';
import { computeArmyVisibility } from '../visibility';

const TERRAIN_SPEED: Record<number, number> = {
  [TERRAIN_CLASS.plain]: 1,
  [TERRAIN_CLASS.hill]: 0.72,
  [TERRAIN_CLASS.mountain]: 0.48,
  [TERRAIN_CLASS.forest]: 0.8,
  [TERRAIN_CLASS.urban]: 0.9,
};
const ROAD_BONUS = 1.35;
/**
 * Global pacing multiplier on how far a stack travels per simulation hour.
 * Tuned purely for feel (strategic movement across a country, not units
 * sliding across the map) — it scales every stack equally, so relative speeds,
 * terrain ordering (plain > hill > mountain) and the road bonus are unchanged.
 * Does NOT touch the simulation tick.
 */
const STRATEGIC_MOVEMENT_SCALE = 0.30;
const EDGE_SAMPLE_DISTANCE = 18;
const edgeProvinceCache = new WeakMap<object, Map<string, number[]>>();

export interface MoveOrderResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly nodes?: number;
  readonly requiredWarCountryIds?: readonly number[];
}

function edgeProvinceIds(session: SimContext, from: number, to: number): number[] {
  const { graph, world } = session;
  const cache = edgeProvinceCache.get(graph) ?? new Map<string, number[]>();
  edgeProvinceCache.set(graph, cache);
  const key = from < to ? `${from}:${to}` : `${to}:${from}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const ax = graph.nodeX[from];
  const az = graph.nodeZ[from];
  let dx = graph.nodeX[to] - ax;
  if (dx > world.width / 2) dx -= world.width;
  else if (dx < -world.width / 2) dx += world.width;
  const dz = graph.nodeZ[to] - az;
  const length = Math.max(1, Math.hypot(dx, dz));
  const steps = Math.max(2, Math.ceil(length / EDGE_SAMPLE_DISTANCE));
  const ids = new Set<number>();
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const x = ((ax + dx * t) % world.width + world.width) % world.width;
    const provinceId = world.provinceAt(x, az + dz * t);
    if (provinceId >= 0) ids.add(provinceId);
  }
  const result = [...ids];
  cache.set(key, result);
  return result;
}

function countriesOnEdge(session: SimContext, from: number, to: number): number[] {
  const countries = new Set<number>();
  for (const provinceId of edgeProvinceIds(session, from, to)) {
    const countryId = session.state.provinceOwners[provinceId] ?? 0;
    if (countryId > 0) countries.add(countryId);
  }
  return [...countries];
}

/** Edge predicate used by movement, pursuit, and friendly-only retreat routing. */
export function movementEdgeAllowed(
  session: SimContext, countryId: number, friendlyOnly = false,
  prospectiveWars: ReadonlySet<number> = new Set(),
): EdgeAllowed {
  return (from, to) => countriesOnEdge(session, from, to).every((ownerId) => (
    ownerId === countryId || (!friendlyOnly && (
      relationOf(session.state, countryId, ownerId) === 'war' || prospectiveWars.has(ownerId)
    ))
  ));
}

function warsRequiredForPath(session: SimContext, countryId: number, path: readonly number[]): number[] {
  const required = new Set<number>();
  for (let i = 1; i < path.length; i += 1) {
    for (const ownerId of countriesOnEdge(session, path[i - 1], path[i])) {
      if (ownerId !== countryId && relationOf(session.state, countryId, ownerId) !== 'war') {
        required.add(ownerId);
      }
    }
  }
  return [...required].sort((a, b) => a - b);
}

function installOrder(
  army: ArmyStack, path: readonly number[], destX: number, destZ: number,
  intent: 'move' | 'attack', target?: MoveOrder['target'],
): void {
  army.order = {
    path: path.slice(1), destX, destZ, intent, target, edgeProgress: 0,
  };
  army.status = 'moving';
  army.extractingNodeId = null;
}

/** Create a route, atomically declaring every confirmed transit war. */
export function issueMoveOrder(
  session: SimContext, armyId: string, destX: number, destZ: number,
  intent: 'move' | 'attack' = 'move', target?: MoveOrder['target'],
  confirmedWarCountryIds: readonly number[] = [],
  forcedWarCountryIds: readonly number[] = [],
): MoveOrderResult {
  const army = session.state.armies[armyId];
  if (!army) return { ok: false, reason: 'No such army.' };
  ensureArmyRuntimeState(army);
  if (army.status === 'engaged') return { ok: false, reason: 'Army is in close combat.' };
  if (army.status === 'retreating') return { ok: false, reason: 'Army is retreating.' };

  const component = session.graph.component[army.graphNodeId] ?? -1;
  const goal = nearestNode(session.graph, destX, destZ, 600, component);
  if (goal < 0) {
    // No reachable land-graph node near the point: it is water/void, or on a
    // landmass this army cannot walk to.
    const anyGoal = nearestNode(session.graph, destX, destZ, 600, -1);
    return anyGoal < 0
      ? { ok: false, reason: 'That destination is off the road network — pick a spot on land.' }
      : { ok: false, reason: 'That destination is on a separate landmass this army cannot reach.' };
  }
  const unrestricted = findPath(session.graph, army.graphNodeId, goal);
  if (!unrestricted) {
    return { ok: false, reason: 'No land route to that location.' };
  }
  const alreadyThere = unrestricted.length < 2;
  if (alreadyThere && intent === 'move') return { ok: false, reason: 'Already there.' };

  const currentlyLegal = findPath(
    session.graph, army.graphNodeId, goal, movementEdgeAllowed(session, army.ownerCountryId),
  );
  const required = new Set(currentlyLegal
    ? [] : warsRequiredForPath(session, army.ownerCountryId, unrestricted));
  for (const countryId of forcedWarCountryIds) {
    if (countryId > 0 && countryId !== army.ownerCountryId
      && relationOf(session.state, army.ownerCountryId, countryId) !== 'war') required.add(countryId);
  }
  const confirmed = new Set(confirmedWarCountryIds);
  const requiredList = [...required].sort((a, b) => a - b);
  const missing = requiredList.filter((id) => !confirmed.has(id));
  if (missing.length > 0) {
    return { ok: false, reason: 'War declaration required.', requiredWarCountryIds: missing };
  }
  const legal = currentlyLegal ?? findPath(
    session.graph, army.graphNodeId, goal,
    movementEdgeAllowed(session, army.ownerCountryId, false, required),
  );
  if (!legal || (!alreadyThere && legal.length < 2)) {
    return { ok: false, reason: 'No legal route to that location.' };
  }
  for (const countryId of required) setRelation(session.state, army.ownerCountryId, countryId, 'war');
  if (alreadyThere) {
    army.order = null;
    if (army.status === 'moving') army.status = 'idle';
    return { ok: true, nodes: 0 };
  }
  installOrder(
    army, legal, session.graph.nodeX[goal], session.graph.nodeZ[goal], intent,
    target ?? { kind: 'position', x: destX, z: destZ },
  );
  return { ok: true, nodes: legal.length - 1 };
}

export function issueStop(session: SimContext, armyId: string): boolean {
  const army = session.state.armies[armyId];
  if (!army) return false;
  ensureArmyRuntimeState(army);
  if (army.status === 'engaged' || army.status === 'retreating') return false;
  army.order = null;
  army.extractingNodeId = null;
  if (army.status === 'moving' || army.status === 'extracting') army.status = 'idle';
  return true;
}

function targetPoint(session: SimContext, army: ArmyStack, order: MoveOrder): [number, number] {
  if (order.target?.kind === 'province') {
    const center = session.world.provinces[order.target.provinceId]?.center;
    return center ? [center[0], center[1]] : [order.destX, order.destZ];
  }
  if (order.target?.kind === 'army') {
    const target = session.state.armies[order.target.armyId];
    const visibility = computeArmyVisibility(session.state, session.world, army.ownerCountryId)
      .get(order.target.armyId) ?? 'hidden';
    if (target && visibility !== 'hidden') {
      order.target.lastKnownX = target.x;
      order.target.lastKnownZ = target.z;
    }
    return [order.target.lastKnownX, order.target.lastKnownZ];
  }
  return order.target?.kind === 'position'
    ? [order.target.x, order.target.z]
    : [order.destX, order.destZ];
}

function revalidateOrder(session: SimContext, army: ArmyStack, order: MoveOrder): void {
  const [targetX, targetZ] = targetPoint(session, army, order);
  const targetArmy = order.target?.kind === 'army' ? session.state.armies[order.target.armyId] : null;
  const targetVisible = targetArmy && order.target?.kind === 'army'
    && (computeArmyVisibility(session.state, session.world, army.ownerCountryId)
      .get(order.target.armyId) ?? 'hidden') !== 'hidden';
  const targetNode = targetArmy && targetVisible
    ? targetArmy.graphNodeId
    : nearestNode(session.graph, targetX, targetZ, 600, session.graph.component[army.graphNodeId]);
  const edgeAllowed = movementEdgeAllowed(session, army.ownerCountryId);
  // A path loaded from a save (or laid before a world rebuild) can contain an
  // edge the audited graph no longer links — e.g. a land connection whose
  // corridor was found to cross water. Treat a missing leading edge exactly
  // like an ownership-blocked one: re-path around it, or stop if nothing legal
  // remains. Without this a stale order lerps a land army straight over water.
  const nextMissing = order.path.length > 0
    && !session.graph.adjacency[army.graphNodeId]?.includes(order.path[0]);
  const nextInvalid = order.path.length > 0
    && (nextMissing || !edgeAllowed(army.graphNodeId, order.path[0]));
  const pursuitChanged = order.target?.kind === 'army'
    && targetNode >= 0 && order.path[order.path.length - 1] !== targetNode;
  if (!nextInvalid && !pursuitChanged) return;

  let path = targetNode >= 0
    ? findPath(session.graph, army.graphNodeId, targetNode, edgeAllowed)
    : null;
  if (!path) {
    path = closestReachablePath(session.graph, army.graphNodeId, targetX, targetZ, edgeAllowed);
  }
  order.path.splice(0, order.path.length, ...path.slice(1));
  Object.assign(order, {
    destX: session.graph.nodeX[path[path.length - 1]] ?? army.x,
    destZ: session.graph.nodeZ[path[path.length - 1]] ?? army.z,
  });
  order.edgeProgress = 0;
}

export interface RetreatPath {
  readonly firstNodeId: number;
  readonly destinationProvinceId: number;
  readonly path: readonly number[];
  readonly length: number;
}

/** Candidate friendly-only escape routes, sorted nearest first. */
export function retreatPaths(
  session: SimContext, army: ArmyStack, allowedFirstNodes?: readonly number[],
): RetreatPath[] {
  const firstNodes = allowedFirstNodes?.length
    ? [...allowedFirstNodes]
    : [...session.graph.adjacency[army.graphNodeId]];
  const allowed = movementEdgeAllowed(session, army.ownerCountryId, true);
  const result: RetreatPath[] = [];
  for (const first of firstNodes) {
    if (!allowed(army.graphNodeId, first)) continue;
    for (const province of session.world.provinces) {
      if ((session.state.provinceOwners[province.id] ?? 0) !== army.ownerCountryId) continue;
      const destinationNode = nearestNode(
        session.graph, province.center[0], province.center[1], 600,
        session.graph.component[first],
      );
      if (destinationNode < 0 || destinationNode === army.graphNodeId) continue;
      const tail = findPath(session.graph, first, destinationNode, allowed);
      if (!tail) continue;
      const path = [army.graphNodeId, ...tail];
      result.push({
        firstNodeId: first,
        destinationProvinceId: province.id,
        path,
        length: pathLength(session.graph, path),
      });
    }
  }
  result.sort((a, b) => a.length - b.length
    || a.destinationProvinceId - b.destinationProvinceId || a.firstNodeId - b.firstNodeId);
  return result;
}

export function issueRetreatOrder(session: SimContext, army: ArmyStack, route: RetreatPath): void {
  ensureArmyRuntimeState(army);
  const last = route.path[route.path.length - 1];
  installOrder(
    army, route.path, session.graph.nodeX[last], session.graph.nodeZ[last], 'move',
    { kind: 'province', provinceId: route.destinationProvinceId },
  );
  army.status = 'retreating';
  army.retreat = {
    destinationProvinceId: route.destinationProvinceId,
    protectedUntilNodeId: route.firstNodeId,
    protected: true,
  };
}

/** Advance every ordered stack. Friendly armies deliberately never auto-merge. */
export function stepMovement(session: SimContext, dtHours: number): void {
  const { graph, world } = session;
  for (const army of Object.values(session.state.armies)) {
    ensureArmyRuntimeState(army);
    const order = army.order;
    if (!order || order.path.length === 0 || army.status === 'engaged') continue;
    revalidateOrder(session, army, order);
    let budget = stackBaseSpeed(army) * dtHours * STRATEGIC_MOVEMENT_SCALE
      * (army.status === 'retreating' ? 3 : 1);

    while (budget > 0 && order.path.length > 0) {
      const targetNode = order.path[0];
      const tx = graph.nodeX[targetNode];
      const tz = graph.nodeZ[targetNode];
      const segLen = Math.max(1, wrappedDistance(army.x, army.z, tx, tz, world.width));
      const speedScale = (TERRAIN_SPEED[world.terrainClassAt(army.x, army.z)] ?? 0.9) * ROAD_BONUS;
      const advance = budget * speedScale;
      if (advance >= segLen) {
        army.x = tx;
        army.z = tz;
        army.lastGraphNodeId = army.graphNodeId;
        army.graphNodeId = targetNode;
        order.path.shift();
        order.edgeProgress = 0;
        budget -= segLen / Math.max(speedScale, 0.01);
        if (army.retreat?.protected && targetNode === army.retreat.protectedUntilNodeId) {
          army.retreat.protected = false;
        }
      } else {
        const t = advance / segLen;
        let dx = tx - army.x;
        if (dx > world.width / 2) dx -= world.width;
        else if (dx < -world.width / 2) dx += world.width;
        army.x = ((army.x + dx * t) % world.width + world.width) % world.width;
        army.z += (tz - army.z) * t;
        order.edgeProgress += advance;
        budget = 0;
      }
    }

    if (order.path.length === 0) {
      const tracking = order.target?.kind === 'army';
      if (tracking) {
        revalidateOrder(session, army, order);
        if (order.path.length > 0) continue;
      }
      army.order = null;
      army.status = 'idle';
      army.retreat = null;
    }
  }
}
