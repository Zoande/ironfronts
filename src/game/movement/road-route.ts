import type { SimContext } from '../sim-context';
import type { ArmyStack, MoveOrder } from '../units/army';
import type { LandGraph, RoadPosition } from './graph';
import { occupiedEdge, routeFromArmy } from './position';
import type { EdgeAllowed } from './pathfind';
import { landRoadHours, movementEdgeTravelCost } from './speed';

/** Price the physical leading edge, including a turn back to its origin. */
function routeHours(ctx: SimContext, army: ArmyStack, graph: LandGraph, path: readonly number[], wars: ReadonlySet<number>): number {
  const occupied = occupiedEdge(ctx, army);
  let hours = 0;
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1], to = path[i];
    if (i === 1 && occupied) {
      const road = graph.edges[occupied.edgeId];
      const origin = to === occupied.to ? occupied.from : occupied.to;
      const start = origin === occupied.from ? occupied.distanceAlongEdge : road.length - occupied.distanceAlongEdge;
      hours += landRoadHours(ctx, army, graph, origin, to, wars, start);
    } else {
      const at = graph.adjacency[from].indexOf(to);
      if (at < 0) return Infinity;
      hours += movementEdgeTravelCost(ctx, army, graph, wars)(from, to, graph.edgeCost[from][at]);
    }
  }
  return hours;
}

/** Shared exact-road planning for initial commands and later route repairs. */
export function routeToRoadPosition(
  ctx: SimContext, army: ArmyStack, graph: LandGraph, point: RoadPosition,
  allowed?: EdgeAllowed, wars: ReadonlySet<number> = new Set(),
): { path: number[]; roadDestination?: MoveOrder['roadDestination'] } | null {
  const road = graph.edges[point.edgeId];
  if (!road) return null;
  const occupied = occupiedEdge(ctx, army);
  const choices: Array<{ path: number[]; roadDestination?: MoveOrder['roadDestination']; hours: number }> = [];
  if (occupied?.edgeId === road.id) {
    const start = occupied.from === road.from ? occupied.distanceAlongEdge : road.length - occupied.distanceAlongEdge;
    const forward = point.distanceAlongEdge >= start;
    const to = forward ? road.to : road.from;
    const from = forward ? road.from : road.to;
    if (to === occupied.from || !allowed || allowed(from, to)) {
      const distance = forward ? point.distanceAlongEdge : road.length - point.distanceAlongEdge;
      const startDistance = forward ? start : road.length - start;
      choices.push({ path: Math.abs(distance - startDistance) <= 1e-6 ? [army.graphNodeId] : [army.graphNodeId, to],
        roadDestination: { edgeId: road.id, from, to, distanceAlongEdge: distance },
        hours: landRoadHours(ctx, army, graph, from, to, wars, startDistance, distance) });
    }
  }
  const cost = movementEdgeTravelCost(ctx, army, graph, wars);
  for (const [from, to, distance] of [
    [road.from, road.to, point.distanceAlongEdge],
    [road.to, road.from, road.length - point.distanceAlongEdge],
  ]) {
    if (distance > 1e-6 && allowed && !allowed(from, to)) continue;
    const base = routeFromArmy(ctx, army, from, allowed, graph, cost);
    if (!base) continue;
    choices.push({ path: distance <= 1e-6 ? base : [...base, to],
      roadDestination: distance <= 1e-6 ? undefined : { edgeId: road.id, from, to, distanceAlongEdge: distance },
      hours: routeHours(ctx, army, graph, base, wars) + landRoadHours(ctx, army, graph, from, to, wars, 0, distance) });
  }
  choices.sort((a, b) => a.hours - b.hours || a.path.length - b.path.length);
  const best = choices.find((choice) => Number.isFinite(choice.hours));
  return best ? { path: best.path, roadDestination: best.roadDestination } : null;
}
