import type { SimContext } from '../sim-context';
import type { ArmyStack } from '../units/army';
import { wrappedDistance } from '../geometry';
import { findPath, pathLength, type EdgeAllowed, type EdgeCost } from './pathfind';
import { edgeDistanceAtPoint, edgeIdBetween, type LandGraph } from './graph';

export const ARRIVAL_DISTANCE = 0.01;

export function armyAtNode(ctx: SimContext, army: ArmyStack, node = army.graphNodeId): boolean {
  return node >= 0 && node < ctx.graph.nodeCount && wrappedDistance(
    army.x, army.z, ctx.graph.nodeX[node], ctx.graph.nodeZ[node], ctx.world.width,
  ) <= ARRIVAL_DISTANCE;
}

/** Physical edge persists through stop, split, combat and order replacement. */
export function occupiedEdge(ctx: SimContext, army: ArmyStack): {
  edgeId: number; from: number; to: number; distanceAlongEdge: number;
} | null {
  if (armyAtNode(ctx, army)) return null;
  if (army.edge) {
    const edgeId = army.edge.edgeId ?? edgeIdBetween(ctx.graph, army.edge.from, army.edge.to);
    if (edgeId < 0) return null;
    return { ...army.edge, edgeId, distanceAlongEdge: army.edge.distanceAlongEdge
      ?? edgeDistanceAtPoint(ctx.graph, edgeId, army.edge.from, army.x, army.z) };
  }
  const next = army.order?.path[0] ?? army.suspendedOrder?.path[0];
  const edgeId = next === undefined ? -1 : edgeIdBetween(ctx.graph, army.graphNodeId, next);
  return next !== undefined && edgeId >= 0
    ? { edgeId, from: army.graphNodeId, to: next,
      distanceAlongEdge: edgeDistanceAtPoint(ctx.graph, edgeId, army.graphNodeId, army.x, army.z) } : null;
}

/** Returns the existing inclusive-node route convention, including a partial
 * leading edge. Reversing on an edge explicitly visits its origin first. */
export function routeFromArmy(
  ctx: SimContext, army: ArmyStack, goal: number, allowed?: EdgeAllowed,
  graph: LandGraph = ctx.graph, edgeCost?: EdgeCost,
): number[] | null {
  if (armyAtNode(ctx, army)) return findPath(graph, army.graphNodeId, goal, allowed, edgeCost);
  const edge = occupiedEdge(ctx, army);
  if (!edge) return null;
  const choices: Array<{ path: number[]; cost: number }> = [];
  for (const endpoint of [edge.from, edge.to]) {
    // Returning to the origin is the only permitted recovery from a blocked edge.
    if (endpoint !== edge.from && allowed && !allowed(edge.from, edge.to)) continue;
    const tail = findPath(graph, endpoint, goal, allowed, edgeCost);
    if (!tail) continue;
    const tailCost = edgeCost
      ? tail.slice(1).reduce((total, node, index) => {
        const from = tail[index];
        const edgeIndex = graph.adjacency[from].indexOf(node);
        return total + edgeCost(from, node, graph.edgeCost[from][edgeIndex]);
      }, 0)
      : pathLength(graph, tail);
    const fullDistance = ctx.graph.edges[edge.edgeId].length;
    const partialDistance = endpoint === edge.from
      ? edge.distanceAlongEdge : fullDistance - edge.distanceAlongEdge;
    const partialCost = edgeCost && fullDistance > 0
      ? edgeCost(edge.from, edge.to, fullDistance) * partialDistance / fullDistance
      : partialDistance;
    choices.push({ path: [army.graphNodeId, ...tail], cost: tailCost + partialCost });
  }
  choices.sort((a, b) => a.cost - b.cost || a.path[1] - b.path[1]);
  return choices[0]?.path ?? null;
}

export function leadingEdgeValid(ctx: SimContext, army: ArmyStack, next: number, allowed: EdgeAllowed): boolean {
  const edge = occupiedEdge(ctx, army);
  if (edge) return (next === edge.from || next === edge.to)
    && ctx.graph.adjacency[edge.from]?.includes(edge.to)
    && (next === edge.from || allowed(edge.from, edge.to));
  return Boolean(ctx.graph.adjacency[army.graphNodeId]?.includes(next)) && allowed(army.graphNodeId, next);
}
