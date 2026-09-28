import { COMBAT_SNAP } from '../combat/constants';
import { supplyEffectiveness } from '../combat/supply';
import { SpatialIndex } from '../spatial-index';
import type { SimContext } from '../sim-context';
import { ensureArmyRuntimeState, mergeStacks, stackBaseSpeed } from './army';
import { armyAtNode, leadingEdgeValid } from '../movement/position';
import { sweptContact } from '../movement/contact';
import { armiesInContact, canEnterCloseCombat, CONTACT_EPSILON, contactPairKey } from '../combat/contact';
import { movementEdgeAllowed } from '../movement/policy';
import { revalidateOrder } from '../movement/pursuit';
import { advanceLandRoad, ROAD_BONUS, STRATEGIC_MOVEMENT_SCALE } from '../movement/speed';
import { beginFinalSeaLeg, beginNavalCrossing, isNavalStatus, isSeaEdge, stepNavalCrossing } from '../movement/naval';
import { wrappedDistance } from '../geometry';
import { computeArmyVisibility } from '../visibility';
import { relationOf } from '../game-state';
import { GAME_PACE } from '../pacing';
import { captureProvinceAtArmyNode, type CaptureEvent } from '../combat/capture';
import { edgeDistanceAtPoint, edgeIdBetween, edgePositionFrom } from '../movement/graph';
export {
  currentMovementLeg, remainingOrderTravelHours, movementEdgeTravelCost,
  ENEMY_LAND_SPEED_MULTIPLIER, type CurrentMovementLeg,
} from '../movement/speed';
export { movementEdgeAllowed, warsRequiredForPath } from '../movement/policy';
export { issueMoveOrder, issueStop, type MoveOrderResult } from '../movement/orders';
export { retreatPaths, issueRetreatOrder, type RetreatPath } from '../movement/retreat';
export { NAVAL_DWELL_HOURS } from '../movement/naval';

// revalidateOrder()/targetPoint() only ever read visibility for an
// order.target.kind === 'army' pursuit; every other order (the overwhelming
// majority — plain point/province moves) never touches it. Stand in with an
// empty map for those so stepMovement doesn't pay for a fog-of-war
// recomputation (one per distinct owning country, every fixed-step tick) it
// will never use.
const EMPTY_VISIBILITY: ReturnType<typeof computeArmyVisibility> = new Map();

// Same graph node is the common case, but a stack that just finished moving
// can land a few world units short of/past the exact node position (the last
// movement step snaps to distance, not to the node) while another idle stack
// sits right on it — visually on top of each other but on technically
// different nodes, and previously never merging. MERGE_RADIUS matches
// COMBAT_SNAP's "close enough to be the same spot" scale.
const MERGE_RADIUS = 26;

function mergeArrivedStacks(session: SimContext, arrivedIds: ReadonlySet<string>): void {
  const worldWidth = session.world.width;
  for (const armyId of arrivedIds) {
    const army = session.state.armies[armyId];
    if (!army || army.status !== 'idle' || army.order || army.battleFrontIds?.length) continue;
    const target = Object.values(session.state.armies).find((other) => other !== army
      && other.ownerCountryId === army.ownerCountryId
      && other.status === 'idle' && !other.order && !other.battleFrontIds?.length
      && ((!army.edge && !other.edge && other.graphNodeId === army.graphNodeId)
        || wrappedDistance(other.x, other.z, army.x, army.z, worldWidth) < MERGE_RADIUS));
    if (target) {
      mergeStacks(target, army);
      delete session.state.armies[army.id];
    }
  }
}

/** Advance every ordered stack, including explicit timed naval crossings. */
export function stepMovement(session: SimContext, dtHours: number, contactTimes?: Map<string, number>): CaptureEvent[] {
  const { graph, world } = session;
  const captures: CaptureEvent[] = [];
  const positions = new SpatialIndex(Object.values(session.state.armies), world.width);
  const arrivedIds = new Set<string>();
  const visibilityByCountry = new Map<number, ReturnType<typeof computeArmyVisibility>>();
  for (const army of Object.values(session.state.armies)) {
    ensureArmyRuntimeState(army);
    const order = army.order;
    if (!order || army.status === 'engaged') continue;
    if (isNavalStatus(army.status)) {
      stepNavalCrossing(session, army, order, dtHours);
      if (!army.order) arrivedIds.add(army.id);
      positions.update(army);
      continue;
    }
    let visibility = EMPTY_VISIBILITY;
    if (order.target?.kind === 'army') {
      visibility = visibilityByCountry.get(army.ownerCountryId)
        ?? computeArmyVisibility(session.state, world, army.ownerCountryId);
      visibilityByCountry.set(army.ownerCountryId, visibility);
    }
    revalidateOrder(session, army, order, visibility);
    const baseSpeed = stackBaseSpeed(army) * STRATEGIC_MOVEMENT_SCALE
      * (army.status === 'retreating' ? GAME_PACE.movement.retreatMultiplier : 1)
      * supplyEffectiveness(army);
    let budget = baseSpeed * dtHours;
    let contactAt: number | undefined;

    while (budget > 1e-9 && order.path.length > 0) {
      const targetNode = order.path[0];
      // The planner treats positions within arrival tolerance as the node.
      // Discard its old outgoing edge before a pursuit picks another exit.
      if (army.edge && armyAtNode(session, army)) army.edge = null;
      if (isSeaEdge(graph, army.graphNodeId, targetNode)) {
        beginNavalCrossing(session, army, targetNode);
        break;
      }
      if (!leadingEdgeValid(
        session, army, targetNode,
        movementEdgeAllowed(session, army.ownerCountryId, army.status === 'retreating'),
      )) {
        order.path.length = 0;
        break;
      }
      const edgeId = army.edge?.edgeId
        ?? (army.edge ? edgeIdBetween(graph, army.edge.from, army.edge.to)
          : edgeIdBetween(graph, army.graphNodeId, targetNode));
      if (edgeId < 0) { order.path.length = 0; break; }
      army.edge ??= { edgeId, from: army.graphNodeId, to: targetNode, distanceAlongEdge: 0 };
      army.edge.edgeId = edgeId;
      army.edge.distanceAlongEdge ??= edgeDistanceAtPoint(
        graph, edgeId, army.edge.from, army.x, army.z,
      );
      const roadEdge = graph.edges[edgeId];
      const forward = targetNode === army.edge.to;
      const exactStop = order.path.length === 1 && order.roadDestination?.edgeId === edgeId
        && order.roadDestination.to === targetNode
        && order.roadDestination.distanceAlongEdge > 1e-6
        && order.roadDestination.distanceAlongEdge < roadEdge.length - 1e-6;
      const exactDistance = exactStop
        ? (army.edge.from === order.roadDestination!.from
          ? order.roadDestination!.distanceAlongEdge
          : roadEdge.length - order.roadDestination!.distanceAlongEdge)
        : null;
      const destination = exactDistance !== null
        ? edgePositionFrom(graph, edgeId, army.edge.from, exactDistance) : null;
      const targetX = destination?.x ?? graph.nodeX[targetNode];
      const targetZ = destination?.z ?? graph.nodeZ[targetNode];
      const segmentLength = exactDistance !== null
        ? Math.abs(exactDistance - army.edge.distanceAlongEdge)
        : forward ? roadEdge.length - army.edge.distanceAlongEdge : army.edge.distanceAlongEdge;
      if (segmentLength <= 1e-9) {
        army.x = targetX;
        army.z = targetZ;
        if (exactStop) {
          army.edge.distanceAlongEdge = exactDistance!;
          order.path.shift();
          order.edgeProgress = 0;
          continue;
        }
        army.lastGraphNodeId = army.graphNodeId;
        army.graphNodeId = targetNode;
        army.edge = null;
        order.path.shift();
        order.edgeProgress = 0;
        const capture = captureProvinceAtArmyNode(session, army);
        if (capture) captures.push(capture);
        continue;
      }
      const requested = Math.min(segmentLength, budget * ROAD_BONUS);
      const increasing = exactDistance !== null
        ? exactDistance >= army.edge.distanceAlongEdge : forward;
      const travelFrom = increasing ? army.edge.from : army.edge.to;
      const travelStart = increasing
        ? army.edge.distanceAlongEdge : roadEdge.length - army.edge.distanceAlongEdge;
      const contact = sweptContact(
        session, army, edgeId, travelFrom, travelStart, requested, positions,
      );
      const travel = advanceLandRoad(session, army, edgeId, travelFrom, travelStart, contact.distance, budget);
      const advance = travel.distance;
      budget = Math.max(0, budget - travel.used);
      const reachedContact = contact.armyId !== undefined && advance >= contact.distance - CONTACT_EPSILON;
      if (reachedContact && contactTimes) {
        const key = contactPairKey(army.id, contact.armyId!);
        const elapsed = Math.max(0, dtHours - budget / baseSpeed);
        contactAt = elapsed;
        contactTimes.set(key, Math.max(contactTimes.get(key) ?? 0, elapsed));
      }
      if (advance <= 1e-9) break;
      if (advance >= segmentLength - 1e-9) {
        army.x = targetX;
        army.z = targetZ;
        if (exactStop) {
          army.edge.distanceAlongEdge = exactDistance!;
          order.path.shift();
          order.edgeProgress = 0;
          continue;
        }
        army.lastGraphNodeId = army.edge && targetNode === army.edge.from
          ? army.edge.to : army.graphNodeId;
        army.edge = null;
        army.graphNodeId = targetNode;
        order.path.shift();
        order.edgeProgress = 0;
        const capture = captureProvinceAtArmyNode(session, army);
        if (capture) captures.push(capture);
      } else {
        army.edge.distanceAlongEdge += increasing ? advance : -advance;
        const point = edgePositionFrom(
          graph, edgeId, army.edge.from, army.edge.distanceAlongEdge,
        );
        army.x = point.x;
        army.z = point.z;
        order.edgeProgress = forward
          ? army.edge.distanceAlongEdge : roadEdge.length - army.edge.distanceAlongEdge;
      }
      if (reachedContact) break;
    }

    positions.update(army);
    if (contactAt !== undefined && contactTimes) {
      // Co-located enemies can share a front. Every participant reached at
      // this stop has the same entry time, not just the closest sweep blocker.
      for (const other of positions.query(army.x,army.z,COMBAT_SNAP + CONTACT_EPSILON)) {
        if (other===army || !canEnterCloseCombat(other)
          || relationOf(session.state,army.ownerCountryId,other.ownerCountryId)!=='war'
          || !armiesInContact(army,other,world.width)) continue;
        const key=contactPairKey(army.id,other.id);
        contactTimes.set(key,Math.max(contactTimes.get(key) ?? 0,contactAt));
      }
    }
    if (army.retreat?.protected && !order.path.includes(army.retreat.protectedUntilNodeId)
      && !positions.query(army.x, army.z, COMBAT_SNAP).some((other) => other !== army
        && relationOf(session.state, army.ownerCountryId, other.ownerCountryId) === 'war'
        && wrappedDistance(army.x, army.z, other.x, other.z, world.width) <= COMBAT_SNAP)) {
      army.retreat.protected = false;
    }
    if (order.path.length === 0 && order.seaDestination) {
      beginFinalSeaLeg(session, army);
      continue;
    }
    if (order.path.length === 0) {
      const tracking = order.target?.kind === 'army';
      if (tracking) {
        revalidateOrder(session, army, order, visibility);
        if (order.path.length > 0) continue;
        const target = order.target?.kind === 'army'
          ? session.state.armies[order.target.armyId] : null;
        if (target && (visibility.get(target.id) ?? 'hidden') !== 'hidden'
          && relationOf(session.state, army.ownerCountryId, target.ownerCountryId) === 'war') {
          continue;
        }
      }
      army.order = null;
      army.status = 'idle';
      army.retreat = null;
      arrivedIds.add(army.id);
    }
  }
  mergeArrivedStacks(session, arrivedIds);
  return captures;
}
