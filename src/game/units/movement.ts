import { COMBAT_SNAP, OUT_OF_SUPPLY_SPEED_MULTIPLIER } from '../combat/constants';
import { SpatialIndex } from '../spatial-index';
import type { SimContext } from '../sim-context';
import { ensureArmyRuntimeState, mergeStacks, stackBaseSpeed } from './army';
import { leadingEdgeValid } from '../movement/position';
import { contactDistance } from '../movement/contact';
import { movementEdgeAllowed } from '../movement/policy';
import { revalidateOrder } from '../movement/pursuit';
import { TERRAIN_SPEED, ROAD_BONUS, STRATEGIC_MOVEMENT_SCALE } from '../movement/speed';
import { beginNavalCrossing, isNavalStatus, isSeaEdge, stepNavalCrossing } from '../movement/naval';
import { wrappedDistance } from '../geometry';
import { computeArmyVisibility } from '../visibility';
import { relationOf } from '../game-state';
import { GAME_PACE } from '../pacing';
export { currentMovementLeg, type CurrentMovementLeg } from '../movement/speed';
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
      && (other.graphNodeId === army.graphNodeId
        || wrappedDistance(other.x, other.z, army.x, army.z, worldWidth) < MERGE_RADIUS));
    if (target) {
      mergeStacks(target, army);
      delete session.state.armies[army.id];
    }
  }
}

/** Advance every ordered stack, including explicit timed naval crossings. */
export function stepMovement(session: SimContext, dtHours: number): void {
  const { graph, world } = session;
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
    let budget = stackBaseSpeed(army) * dtHours * STRATEGIC_MOVEMENT_SCALE
      * (army.status === 'retreating' ? GAME_PACE.movement.retreatMultiplier : 1)
      * (army.inSupply === false ? OUT_OF_SUPPLY_SPEED_MULTIPLIER : 1);

    while (budget > 0 && order.path.length > 0) {
      const targetNode = order.path[0];
      if (isSeaEdge(graph, army.graphNodeId, targetNode)) {
        beginNavalCrossing(army, targetNode);
        break;
      }
      if (!leadingEdgeValid(
        session, army, targetNode,
        movementEdgeAllowed(session, army.ownerCountryId, army.status === 'retreating'),
      )) {
        order.path.length = 0;
        break;
      }
      army.edge ??= { from: army.graphNodeId, to: targetNode };
      const targetX = graph.nodeX[targetNode];
      const targetZ = graph.nodeZ[targetNode];
      const segmentLength = wrappedDistance(army.x, army.z, targetX, targetZ, world.width);
      if (segmentLength <= 1e-9) {
        army.x = targetX;
        army.z = targetZ;
        army.lastGraphNodeId = army.graphNodeId;
        army.graphNodeId = targetNode;
        army.edge = null;
        order.path.shift();
        order.edgeProgress = 0;
        continue;
      }
      const speedScale = (TERRAIN_SPEED[world.terrainClassAt(army.x, army.z)] ?? 0.9)
        * ROAD_BONUS;
      const requested = Math.min(segmentLength, budget * speedScale);
      const advance = contactDistance(session, army, targetX, targetZ, requested, positions);
      if (advance <= 1e-9) break;
      if (advance >= segmentLength - 1e-9) {
        army.x = targetX;
        army.z = targetZ;
        army.lastGraphNodeId = army.edge && targetNode === army.edge.from
          ? army.edge.to : army.graphNodeId;
        army.edge = null;
        army.graphNodeId = targetNode;
        order.path.shift();
        order.edgeProgress = 0;
        budget -= segmentLength / Math.max(speedScale, 0.01);
      } else {
        const ratio = advance / segmentLength;
        let dx = targetX - army.x;
        if (dx > world.width / 2) dx -= world.width;
        else if (dx < -world.width / 2) dx += world.width;
        army.x = ((army.x + dx * ratio) % world.width + world.width) % world.width;
        army.z += (targetZ - army.z) * ratio;
        order.edgeProgress += advance;
        budget = 0;
      }
    }

    positions.update(army);
    if (army.retreat?.protected && !order.path.includes(army.retreat.protectedUntilNodeId)
      && !positions.query(army.x, army.z, COMBAT_SNAP).some((other) => other !== army
        && relationOf(session.state, army.ownerCountryId, other.ownerCountryId) === 'war'
        && wrappedDistance(army.x, army.z, other.x, other.z, world.width) <= COMBAT_SNAP)) {
      army.retreat.protected = false;
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
}
