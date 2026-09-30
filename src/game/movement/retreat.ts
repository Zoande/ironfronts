import type { SimContext } from '../sim-context';
import type { ArmyStack } from '../units/army';
import { ensureArmyRuntimeState } from '../units/army';
import { canonicalEdgeDistance, occupiedEdge } from './position';
import { shortestPaths } from './pathfind';
import { nearestNode } from './graph';
import { movementEdgeAllowed } from './policy';
import { wrappedDistance } from '../geometry';
import { installOrder } from './orders';
import { movementEdgeTravelCost } from './speed';

export interface RetreatPath {
  readonly firstNodeId: number;
  readonly destinationProvinceId: number;
  readonly path: readonly number[];
  readonly length: number;
}
const provinceNodeCache = new WeakMap<object, Map<number, number>>();

function provinceNodes(session: SimContext, component: number): Array<{ id:number; node:number }> {
  let cached = provinceNodeCache.get(session.graph);
  if (!cached) {
    cached = new Map(session.world.provinces.map((province) => [province.id,
      nearestNode(session.graph, province.center[0], province.center[1], 600)]));
    provinceNodeCache.set(session.graph, cached);
  }
  return session.world.provinces.map((province) => ({ id:province.id, node:cached!.get(province.id) ?? -1 }))
    .filter((entry) => entry.node >= 0 && session.graph.component[entry.node] === component);
}

/** Candidate friendly-only escape routes, sorted nearest first. */
export function retreatPaths(
  session: SimContext, army: ArmyStack, allowedFirstNodes?: readonly number[],
): RetreatPath[] {
  const firstNodes = allowedFirstNodes !== undefined
    ? [...allowedFirstNodes]
    : [...session.graph.adjacency[army.graphNodeId]];
  const allowed = movementEdgeAllowed(session, army.ownerCountryId, true);
  const result: RetreatPath[] = [];
  const destinations = provinceNodes(session, session.graph.component[army.graphNodeId])
    .filter((province) => session.state.provinceOwners[province.id] === army.ownerCountryId);
  const edge = occupiedEdge(session, army);
  for (const first of firstNodes) {
    const edgeEndpoint = edge && (first === edge.from || first === edge.to);
    const partialReturn = edgeEndpoint && first === edge.from;
    if (!partialReturn && (!session.graph.adjacency[army.graphNodeId]?.includes(first) || !allowed(army.graphNodeId, first))) continue;
    const blockedEndpoint = edgeEndpoint ? (first === edge.from ? edge.to : edge.from) : army.graphNodeId;
    const {distance,parent} = shortestPaths(session.graph, first, (from,to) => allowed(from,to)
      && to !== blockedEndpoint,
    movementEdgeTravelCost(session, army, session.graph));
    for (const destination of destinations) {
      if (!partialReturn && destination.node === army.graphNodeId || !Number.isFinite(distance[destination.node])) continue;
      const tail=[destination.node];
      for (let node=destination.node;parent[node]>=0;node=parent[node]) tail.push(parent[node]);
      tail.reverse();
      // The path convention includes the current node. A partial turn back
      // repeats edge.from so installOrder leaves it as the first target.
      const path=[army.graphNodeId,...tail];
      const road = edge ? session.graph.edges[edge.edgeId] : null;
      const canonical = edge ? canonicalEdgeDistance(session.graph, edge) : 0;
      const leadDistance = edgeEndpoint && road
        ? (first === road.from ? canonical : road.length - canonical)
        : wrappedDistance(
          army.x, army.z, session.graph.nodeX[first], session.graph.nodeZ[first], session.world.width,
        );
      const edgeIndex = session.graph.adjacency[army.graphNodeId]?.indexOf(first) ?? -1;
      const fullDistance = edgeEndpoint && road ? road.length
        : edgeIndex >= 0 ? session.graph.edgeCost[army.graphNodeId][edgeIndex] : leadDistance;
      const leadCost = fullDistance > 0
        ? movementEdgeTravelCost(session, army, session.graph)(
          edgeEndpoint && road ? road.from : army.graphNodeId,
          edgeEndpoint && road ? road.to : first,
          fullDistance,
        )
          * leadDistance / fullDistance
        : 0;
      result.push({firstNodeId:first,destinationProvinceId:destination.id,path,
        length:distance[destination.node]+leadCost});
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
  army.suspendedOrder = null;
  army.status = 'retreating';
  army.retreat = {
    destinationProvinceId: route.destinationProvinceId,
    protectedUntilNodeId: route.firstNodeId,
    protected: true,
  };
}

