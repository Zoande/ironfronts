import type { SimContext } from '../sim-context';
import type { ArmyStack, ArmyStatus, MoveOrder } from '../units/army';
import { stackBaseSpeed } from '../units/army';
import { wrappedDistance } from '../geometry';
import type { LandGraph } from './graph';
import { GAME_PACE } from '../pacing';
import { ROAD_BONUS, STRATEGIC_MOVEMENT_SCALE } from './speed';

/** Thirty real minutes each to embark and disembark on the authoritative 1x timeline. */
export const NAVAL_DWELL_HOURS = GAME_PACE.movement.navalDwellHours;

const combinedGraphCache = new WeakMap<LandGraph, LandGraph>();

/** A routable view used only when a land-only route cannot reach the destination. */
export function combinedGraph(graph: LandGraph): LandGraph {
  const cached = combinedGraphCache.get(graph);
  if (cached) return cached;
  const adjacency = graph.adjacency.map((list, node) => [...list, ...graph.seaAdjacency[node]]);
  const edgeCost = graph.edgeCost.map((list, node) => [...list, ...graph.seaEdgeCost[node]]);
  const component = new Int32Array(graph.nodeCount).fill(-1);
  const componentSize: number[] = [];
  const stack: number[] = [];
  for (let seed = 0; seed < graph.nodeCount; seed += 1) {
    if (component[seed] !== -1) continue;
    const componentId = componentSize.length;
    component[seed] = componentId;
    stack.push(seed);
    let size = 0;
    while (stack.length) {
      const current = stack.pop()!;
      size += 1;
      for (const next of adjacency[current]) {
        if (component[next] !== -1) continue;
        component[next] = componentId;
        stack.push(next);
      }
    }
    componentSize.push(size);
  }
  const result: LandGraph = { ...graph, adjacency, edgeCost, component, componentSize };
  combinedGraphCache.set(graph, result);
  return result;
}

export function isSeaEdge(graph: LandGraph, from: number, to: number): boolean {
  return graph.seaAdjacency[from]?.includes(to) ?? false;
}

export function isNavalStatus(status: ArmyStatus): boolean {
  return status === 'embarking' || status === 'atSea' || status === 'disembarking';
}

export function beginNavalCrossing(army: ArmyStack, targetNode: number): void {
  army.edge = null;
  army.status = 'embarking';
  army.navalCrossing = {
    fromNodeId: army.graphNodeId,
    toNodeId: targetNode,
    hoursRemaining: NAVAL_DWELL_HOURS,
  };
}

/** Advance one explicit embark, transit, and disembark state machine. */
export function stepNavalCrossing(
  session: SimContext, army: ArmyStack, order: MoveOrder, dtHours: number,
): void {
  const crossing = army.navalCrossing;
  if (!crossing || !isSeaEdge(session.graph, crossing.fromNodeId, crossing.toNodeId)) {
    army.navalCrossing = null;
    army.order = null;
    army.status = 'idle';
    return;
  }
  if (army.status === 'embarking') {
    crossing.hoursRemaining -= dtHours;
    if (crossing.hoursRemaining <= 0) army.status = 'atSea';
    return;
  }
  if (army.status === 'atSea') {
    const targetX = session.graph.nodeX[crossing.toNodeId];
    const targetZ = session.graph.nodeZ[crossing.toNodeId];
    const remaining = wrappedDistance(
      army.x, army.z, targetX, targetZ, session.world.width,
    );
    const advance = stackBaseSpeed(army) * dtHours * STRATEGIC_MOVEMENT_SCALE * ROAD_BONUS;
    if (remaining <= 1e-9 || advance >= remaining) {
      army.x = targetX;
      army.z = targetZ;
      army.lastGraphNodeId = army.graphNodeId;
      army.graphNodeId = crossing.toNodeId;
      order.path.shift();
      order.edgeProgress = 0;
      army.status = 'disembarking';
      crossing.hoursRemaining = NAVAL_DWELL_HOURS;
    } else {
      const ratio = advance / remaining;
      let dx = targetX - army.x;
      if (dx > session.world.width / 2) dx -= session.world.width;
      else if (dx < -session.world.width / 2) dx += session.world.width;
      army.x = ((army.x + dx * ratio) % session.world.width + session.world.width)
        % session.world.width;
      army.z += (targetZ - army.z) * ratio;
      order.edgeProgress += advance;
    }
    return;
  }
  crossing.hoursRemaining -= dtHours;
  if (crossing.hoursRemaining > 0) return;
  army.navalCrossing = null;
  if (order.path.length) army.status = 'moving';
  else {
    army.order = null;
    army.status = 'idle';
    army.retreat = null;
  }
}
