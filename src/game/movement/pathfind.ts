/**
 * A* pathfinding on the land movement graph.
 *
 * Pure. Returns the node-id sequence from `start` to `goal` inclusive, or
 * `null` when they are not connected (different components — e.g. an island
 * exclave). The heuristic is straight-line wrapped distance, which is
 * admissible because every edge cost is the true wrapped distance between its
 * endpoints.
 */

import type { LandGraph } from './graph';
import { MinHeap } from './min-heap';
import { wrappedDistance } from '../geometry';

export type EdgeAllowed = (from: number, to: number) => boolean;
export type EdgeCost = (from: number, to: number, geometricCost: number) => number;

export function findPath(
  graph: LandGraph, start: number, goal: number, edgeAllowed?: EdgeAllowed,
  edgeCost?: EdgeCost,
): number[] | null {
  if (start < 0 || goal < 0 || start >= graph.nodeCount || goal >= graph.nodeCount) return null;
  if (start === goal) return [start];
  if (graph.component[start] !== graph.component[goal]) return null;

  // A caller-supplied cost may include terrain, hostile-territory and naval
  // handling time. There is no generally admissible geometric heuristic for
  // that, so weighted searches deliberately become Dijkstra searches.
  const h = edgeCost ? (_node: number): number => 0 : (node: number): number => wrappedDistance(
    graph.nodeX[node], graph.nodeZ[node], graph.nodeX[goal], graph.nodeZ[goal], graph.width,
  );

  const gScore = new Float64Array(graph.nodeCount).fill(Infinity);
  const cameFrom = new Int32Array(graph.nodeCount).fill(-1);
  gScore[start] = 0;

  const heap = new MinHeap();
  heap.push(h(start), start);

  const closed = new Uint8Array(graph.nodeCount);
  while (heap.size > 0) {
    const [, current] = heap.pop();
    if (current === goal) {
      const path: number[] = [current];
      let node = current;
      while (cameFrom[node] !== -1) {
        node = cameFrom[node];
        path.push(node);
      }
      path.reverse();
      return path;
    }
    if (closed[current]) continue;
    closed[current] = 1;

    const neighbours = graph.adjacency[current];
    const costs = graph.edgeCost[current];
    for (let k = 0; k < neighbours.length; k += 1) {
      const next = neighbours[k];
      if (closed[next]) continue;
      if (edgeAllowed && !edgeAllowed(current, next)) continue;
      const stepCost = edgeCost ? edgeCost(current, next, costs[k]) : costs[k];
      if (!Number.isFinite(stepCost) || stepCost < 0) continue;
      const tentative = gScore[current] + stepCost;
      if (tentative < gScore[next]) {
        gScore[next] = tentative;
        cameFrom[next] = current;
        heap.push(tentative + h(next), next);
      }
    }
  }
  return null;
}

/** Reachable node geometrically closest to a target, plus the path to it. */
export function closestReachablePath(
  graph: LandGraph, start: number, targetX: number, targetZ: number,
  edgeAllowed?: EdgeAllowed, edgeCost?: EdgeCost,
): number[] {
  if (start < 0 || start >= graph.nodeCount) return [];
  const { distance, parent } = shortestPaths(graph, start, edgeAllowed, edgeCost);
  let best = start;
  let bestTarget = wrappedDistance(graph.nodeX[start], graph.nodeZ[start], targetX, targetZ, graph.width);
  for (let node = 0; node < graph.nodeCount; node++) {
    if (!Number.isFinite(distance[node])) continue;
    const targetDistance = wrappedDistance(graph.nodeX[node], graph.nodeZ[node], targetX, targetZ, graph.width);
    if (targetDistance < bestTarget) { best = node; bestTarget = targetDistance; }
  }
  const path = [best];
  for (let node = best; parent[node] >= 0; node = parent[node]) path.push(parent[node]);
  path.reverse();
  return path;
}

/** Total world-distance length of a node path. */
export function pathLength(graph: LandGraph, path: readonly number[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    const from = path[i - 1];
    const edgeIndex = graph.adjacency[from].indexOf(path[i]);
    if (edgeIndex < 0) return Infinity;
    total += graph.edgeCost[from][edgeIndex];
  }
  return total;
}

/** One Dijkstra pass serves every possible destination of a retreat exit. */
export function shortestPaths(
  graph: LandGraph, start: number, allowed?: EdgeAllowed, edgeCost?: EdgeCost,
): { distance: Float64Array; parent: Int32Array } {
  const distance = new Float64Array(graph.nodeCount).fill(Infinity), parent = new Int32Array(graph.nodeCount).fill(-1);
  if (start < 0 || start >= graph.nodeCount) return { distance, parent };
  distance[start] = 0;
  const heap = new MinHeap(); heap.push(0,start);
  while (heap.size) {
    const [cost,node] = heap.pop();
    if (cost !== distance[node]) continue;
    for (let i=0;i<graph.adjacency[node].length;i++) {
      const next=graph.adjacency[node][i];
      if (allowed && !allowed(node,next)) continue;
      const baseCost=graph.edgeCost[node][i];
      const stepCost=edgeCost?edgeCost(node,next,baseCost):baseCost;
      if (!Number.isFinite(stepCost) || stepCost < 0) continue;
      const candidate=cost+stepCost;
      if (candidate < distance[next]) { distance[next]=candidate;parent[next]=node;heap.push(candidate,next); }
    }
  }
  return { distance,parent };
}
