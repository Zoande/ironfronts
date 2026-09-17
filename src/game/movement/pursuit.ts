import type { SimContext } from '../sim-context';
import type { ArmyStack, MoveOrder } from '../units/army';
import { computeArmyVisibility } from '../visibility';
import { nearestNode } from './graph';
import { movementEdgeAllowed } from './policy';
import { routeFromArmy, leadingEdgeValid } from './position';
import { closestReachablePath } from './pathfind';
import { combinedGraph, isSeaEdge } from './naval';
import { movementEdgeTravelCost } from './speed';

function targetPoint(session: SimContext, army: ArmyStack, order: MoveOrder,
  visibility = computeArmyVisibility(session.state, session.world, army.ownerCountryId)): [number, number] {
  if (order.target?.kind === 'province') {
    if (order.target.x !== undefined && order.target.z !== undefined) {
      return [order.target.x, order.target.z];
    }
    const provinceId = order.target.provinceId;
    const center = session.world.provinces.find((p) => p.id === provinceId)?.center;
    return center ? [center[0], center[1]] : [order.destX, order.destZ];
  }
  if (order.target?.kind === 'army') {
    const target = session.state.armies[order.target.armyId];
    const contact = visibility.get(order.target.armyId) ?? 'hidden';
    if (target && contact !== 'hidden') {
      order.target.lastKnownX = target.x;
      order.target.lastKnownZ = target.z;
    }
    return [order.target.lastKnownX, order.target.lastKnownZ];
  }
  return order.target?.kind === 'position'
    ? [order.target.x, order.target.z]
    : [order.destX, order.destZ];
}

export function revalidateOrder(session: SimContext, army: ArmyStack, order: MoveOrder,
  visibility = computeArmyVisibility(session.state, session.world, army.ownerCountryId)): void {
  if (order.path.length > 0 && isSeaEdge(session.graph, army.graphNodeId, order.path[0])) return;
  const [targetX, targetZ] = targetPoint(session, army, order, visibility);
  const targetArmy = order.target?.kind === 'army' ? session.state.armies[order.target.armyId] : null;
  const targetVisible = targetArmy && order.target?.kind === 'army'
    && (visibility.get(order.target.armyId) ?? 'hidden') !== 'hidden';
  const merged = combinedGraph(session.graph);
  const targetNode = targetArmy && targetVisible
    ? (targetArmy.edge?.to ?? targetArmy.order?.path[0] ?? targetArmy.graphNodeId)
    : nearestNode(merged, targetX, targetZ, 600, merged.component[army.graphNodeId]);
  const edgeAllowed = movementEdgeAllowed(session, army.ownerCountryId, army.status === 'retreating');
  const nextInvalid = order.path.length > 0 && !leadingEdgeValid(session, army, order.path[0], edgeAllowed);
  const pursuitChanged = order.target?.kind === 'army'
    && targetNode >= 0 && order.path[order.path.length - 1] !== targetNode;
  if (!nextInvalid && !pursuitChanged) return;

  let routeGraph = session.graph;
  let path = targetNode >= 0
    ? routeFromArmy(
      session, army, targetNode, edgeAllowed, routeGraph,
      movementEdgeTravelCost(session, army, routeGraph),
    )
    : null;
  if (!path && targetNode >= 0) {
    routeGraph = merged;
    path = routeFromArmy(
      session, army, targetNode, edgeAllowed, routeGraph,
      movementEdgeTravelCost(session, army, routeGraph),
    );
  }
  if (!path) {
    const cost = movementEdgeTravelCost(session, army, routeGraph);
    const nearest = closestReachablePath(
      routeGraph, army.graphNodeId, targetX, targetZ, edgeAllowed, cost,
    );
    path = routeFromArmy(
      session, army, nearest[nearest.length - 1], edgeAllowed, routeGraph, cost,
    ) ?? [army.graphNodeId];
  }
  order.path.splice(0, order.path.length, ...path.slice(1));
  Object.assign(order, {
    destX: session.graph.nodeX[path[path.length - 1]] ?? army.x,
    destZ: session.graph.nodeZ[path[path.length - 1]] ?? army.z,
  });
  order.edgeProgress = 0;
}

