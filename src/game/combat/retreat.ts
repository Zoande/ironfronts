import { armyApproachNode, canonicalEdgeDistance, occupiedEdge } from '../movement/position';
import { edgePolyline } from '../movement/graph';
import { wrappedDistance } from '../geometry';
import type { BattleFrontSideState, BattleFrontState } from '../game-state';
import type { SimContext } from '../sim-context';
import type { ArmyStack } from '../units/army';
import { issueRetreatOrder, retreatPaths, type RetreatPath } from '../units/movement';
import {
  sideArmies, sideHp, sideBaseline, sideOrganizationFraction, sideRetreatThresholdMultiplier, removeArmyFromAllFronts,
} from './fronts';
import { ORGANIZATION_RETREAT_THRESHOLD } from './constants';

function legalFirstNodes(session: SimContext, army: ArmyStack, front: BattleFrontState): number[] {
  const edge = occupiedEdge(session, army);
  if (edge) {
    const road = session.graph.edges[edge.edgeId];
    const ownDistance = canonicalEdgeDistance(session.graph, edge);
    const blocked = new Set<number>();
    for (const frontId of army.battleFrontIds ?? []) {
      const active = session.state.battleFronts[frontId];
      if (!active) continue;
      const hostileSide = active.sideA.countryId === army.ownerCountryId ? active.sideB : active.sideA;
      for (const hostile of sideArmies(session, hostileSide)) {
        const hostileEdge = occupiedEdge(session, hostile);
        if (hostileEdge?.edgeId === edge.edgeId) {
          const hostileDistance = canonicalEdgeDistance(session.graph, hostileEdge);
          if (hostileDistance < ownDistance - 1e-6) blocked.add(road.from);
          else if (hostileDistance > ownDistance + 1e-6) blocked.add(road.to);
          else if (hostileSide.directionNodeId === road.from || hostileSide.directionNodeId === road.to) {
            blocked.add(hostileSide.directionNodeId);
          }
        } else if (hostileSide.directionNodeId === road.from || hostileSide.directionNodeId === road.to) {
          blocked.add(hostileSide.directionNodeId);
        }
      }
    }
    const exits = [road.from, road.to].filter((node) => !blocked.has(node));
    return blocked.size > 0 ? exits : [armyApproachNode(session, army)];
  }
  if (front.kind === 'road' && armyApproachNode(session, army) !== army.graphNodeId) {
    return [armyApproachNode(session, army)];
  }
  // A stationary defender that never moved has no lastGraphNodeId and a road
  // front has no province context either, so neither can name "the way it
  // came" as the sole exit. Fall back to any adjacent node that isn't itself
  // a hostile approach, same as a province front.
  const hostileApproaches = new Set<number>();
  for (const other of Object.values(session.state.battleFronts)) {
    if (other.battleId !== front.battleId) continue;
    for (const side of [other.sideA, other.sideB]) {
      if (side.countryId !== army.ownerCountryId) hostileApproaches.add(side.directionNodeId);
    }
  }
  return session.graph.adjacency[army.graphNodeId].filter((id) => !hostileApproaches.has(id));
}

export function legalRetreatPaths(session: SimContext, armyId: string): RetreatPath[] {
  const army = session.state.armies[armyId];
  if (!army || army.status !== 'engaged') return [];
  const front = army.battleFrontIds?.map((id) => session.state.battleFronts[id]).find(Boolean);
  if (!front) return [];
  // Retreat selection is directional: commands and map highlights are keyed by
  // firstNodeId. `retreatPaths` can find the same exit once for every reachable
  // friendly province, so retain only its shortest (first, due to sorting)
  // route instead of flooding the projection with duplicate exit choices.
  const uniqueExits = new Map<number, RetreatPath>();
  for (const route of retreatPaths(session, army, legalFirstNodes(session, army, front))) {
    if (!uniqueExits.has(route.firstNodeId)) uniqueExits.set(route.firstNodeId, route);
  }
  return [...uniqueExits.values()];
}

export function issueManualRetreat(
  session: SimContext, armyId: string, targetX: number, targetZ: number,
): { ok: boolean; reason?: string } {
  const army = session.state.armies[armyId];
  if (!army || army.status !== 'engaged') return { ok: false, reason: 'Army is not in close combat.' };
  const front = army.battleFrontIds?.map((id) => session.state.battleFronts[id]).find(Boolean);
  if (!front) return { ok: false, reason: 'Army is not in close combat.' };

  // Retreat targeting behaves like Move: the click is a world destination.
  // First resolve the road edge most closely aimed at the cursor, including
  // hostile edges. If that edge is not a legal escape, do not silently snap the
  // army sideways or through the enemy line.
  const wrappedX = (value: number): number => {
    const half = session.world.width / 2;
    return (((value + half) % session.world.width) + session.world.width) % session.world.width - half;
  };
  const dx = wrappedX(targetX - army.x);
  const dz = targetZ - army.z;
  if (Math.hypot(dx, dz) < 1) return { ok: false, reason: 'Choose a retreat destination away from the battle.' };
  let aimedFirstNode = -1;
  let aimedScore = -Infinity;
  const edge = occupiedEdge(session, army);
  const aimedNodes = edge ? [edge.from, edge.to] : session.graph.adjacency[army.graphNodeId];
  for (const nodeId of aimedNodes) {
    let edgeX = wrappedX(session.graph.nodeX[nodeId] - army.x);
    let edgeZ = session.graph.nodeZ[nodeId] - army.z;
    if (edge) {
      const road = session.graph.edges[edge.edgeId];
      const canonical = canonicalEdgeDistance(session.graph, edge);
      const from = nodeId === road.from ? road.to : road.from;
      const start = nodeId === road.from ? road.length - canonical : canonical;
      const points = edgePolyline(session.graph, edge.edgeId, from, start, Math.min(road.length, start + 50));
      const sample = points.find((point) => wrappedDistance(
        army.x, army.z, point.x, point.z, session.world.width,
      ) > 1e-6);
      if (sample) {
        edgeX = wrappedX(sample.x - army.x);
        edgeZ = sample.z - army.z;
      }
    }
    const score = (edgeX * dx + edgeZ * dz) / (Math.hypot(edgeX, edgeZ) * Math.hypot(dx, dz) || 1);
    if (score > aimedScore) { aimedScore = score; aimedFirstNode = nodeId; }
  }

  const routes = retreatPaths(session, army, legalFirstNodes(session, army, front))
    .filter((candidate) => candidate.firstNodeId === aimedFirstNode);
  if (!routes.length) return { ok: false, reason: 'Cannot retreat toward the enemy or through non-friendly territory.' };
  const route = routes.sort((a, b) => {
    const provinceA = session.world.provinces.find((province) => province.id === a.destinationProvinceId);
    const provinceB = session.world.provinces.find((province) => province.id === b.destinationProvinceId);
    const distanceA = provinceA ? wrappedDistance(provinceA.center[0], provinceA.center[1], targetX, targetZ, session.world.width) : Infinity;
    const distanceB = provinceB ? wrappedDistance(provinceB.center[0], provinceB.center[1], targetX, targetZ, session.world.width) : Infinity;
    return distanceA - distanceB || a.length - b.length;
  })[0];
  removeArmyFromAllFronts(session, armyId);
  issueRetreatOrder(session, army, route);
  return { ok: true };
}

export function autoRetreat(session: SimContext, front: BattleFrontState, side: BattleFrontSideState): boolean {
  const armies = sideArmies(session, side);
  if (armies.length === 0) return false;
  // Near-annihilation still forces a retreat outright; a broken-but-largely-
  // intact force is also pulled back once its organization collapses, so a
  // battle can be lost without the loser being wiped out first.
  const nearlyDestroyed = sideHp(session, side) < sideBaseline(side) * 0.1;
  const threshold = ORGANIZATION_RETREAT_THRESHOLD * sideRetreatThresholdMultiplier(session, side);
  const brokenOrganization = sideOrganizationFraction(session, side) < threshold;
  if (!nearlyDestroyed && !brokenOrganization) return false;
  let retreated = false;
  for (const army of armies) {
    const route = retreatPaths(session, army, legalFirstNodes(session, army, front))[0];
    if (!route) continue;
    removeArmyFromAllFronts(session, army.id);
    issueRetreatOrder(session, army, route);
    retreated = true;
  }
  return retreated;
}

