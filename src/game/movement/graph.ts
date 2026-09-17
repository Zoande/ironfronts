/** Canonical road graph built from the same centerlines that generate the road mesh. */

import { wrapX, wrappedDistance } from '../geometry';
import type { CanonicalRoadNetwork } from '../world-data';

export const GRAPH_CELL = 20;
const CONNECTION_STRIDE = 8;
const MEDIUM_LAND = 1;
const MEDIUM_SEA = 0;

export interface RoadGraphEdge {
  readonly id: number;
  readonly from: number;
  readonly to: number;
  readonly length: number;
  readonly pointOffset: number;
  readonly pointCount: number;
  readonly dotted: boolean;
}

export interface LandGraph {
  readonly nodeX: Float64Array;
  readonly nodeZ: Float64Array;
  readonly adjacency: readonly number[][];
  readonly edgeCost: readonly number[][];
  readonly adjacencyEdgeId: readonly number[][];
  readonly edges: readonly RoadGraphEdge[];
  readonly centerlines: Float32Array;
  readonly component: Int32Array;
  readonly componentSize: readonly number[];
  readonly nodeCount: number;
  readonly width: number;
  readonly height: number;
  readonly seaAdjacency: readonly number[][];
  readonly seaEdgeCost: readonly number[][];
}

function components(adjacency: readonly number[][]): { component: Int32Array; componentSize: number[] } {
  const component = new Int32Array(adjacency.length).fill(-1);
  const componentSize: number[] = [];
  const stack: number[] = [];
  for (let seed = 0; seed < adjacency.length; seed += 1) {
    if (component[seed] !== -1) continue;
    const componentId = componentSize.length;
    component[seed] = componentId;
    stack.push(seed);
    let size = 0;
    while (stack.length) {
      const current = stack.pop()!;
      size += 1;
      for (const next of adjacency[current]) if (component[next] === -1) {
        component[next] = componentId;
        stack.push(next);
      }
    }
    componentSize.push(size);
  }
  return { component, componentSize };
}

export function buildLandGraph(
  connections: Float32Array,
  width: number,
  height: number,
  canonical?: CanonicalRoadNetwork,
): LandGraph {
  if (canonical) {
    if (canonical.version !== 1) throw new Error(`Unsupported canonical road version: ${canonical.version}`);
    canonical.nodes.forEach((node, id) => {
      if (node.id !== id || !Number.isFinite(node.x) || !Number.isFinite(node.z)) {
        throw new Error('Canonical road nodes must be dense and finite.');
      }
    });
    for (const edge of canonical.edges) {
      const end = (edge.pointOffset + edge.pointCount) * 2;
      if (edge.from < 0 || edge.from >= canonical.nodes.length || edge.to < 0 || edge.to >= canonical.nodes.length
        || edge.pointCount < 2 || edge.pointOffset < 0 || end > canonical.centerlines.length
        || !Number.isFinite(edge.length) || edge.length <= 0) {
        throw new Error('Canonical road edge metadata is invalid.');
      }
    }
  }
  const xs: number[] = canonical?.nodes.map((node) => wrapX(node.x, width)) ?? [];
  const zs: number[] = canonical?.nodes.map((node) => node.z) ?? [];
  const adjacency: number[][] = xs.map(() => []);
  const edgeCost: number[][] = xs.map(() => []);
  const adjacencyEdgeId: number[][] = xs.map(() => []);
  const seaAdjacency: number[][] = xs.map(() => []);
  const seaEdgeCost: number[][] = xs.map(() => []);
  const edges: RoadGraphEdge[] = [];
  const centerlineValues: number[] = canonical ? Array.from(canonical.centerlines) : [];

  const cellKey = (x: number, z: number): number => (
    Math.round(wrapX(x, width) / GRAPH_CELL) * 1_000_000 + Math.round(z / GRAPH_CELL)
  );
  const idByKey = new Map<number, number>();
  for (let id = 0; id < xs.length; id += 1) if (!idByKey.has(cellKey(xs[id], zs[id]))) {
    idByKey.set(cellKey(xs[id], zs[id]), id);
  }
  const getNode = (x: number, z: number): number => {
    const key = cellKey(x, z);
    const found = idByKey.get(key);
    if (found !== undefined) return found;
    const id = xs.length;
    idByKey.set(key, id);
    xs.push(wrapX(x, width)); zs.push(z);
    adjacency.push([]); edgeCost.push([]); adjacencyEdgeId.push([]);
    seaAdjacency.push([]); seaEdgeCost.push([]);
    return id;
  };
  const linkRoad = (edge: RoadGraphEdge): void => {
    const link = (a: number, b: number): void => {
      const at = adjacency[a].indexOf(b);
      if (at < 0) {
        adjacency[a].push(b); edgeCost[a].push(edge.length); adjacencyEdgeId[a].push(edge.id);
      } else if (edge.length < edgeCost[a][at]) {
        edgeCost[a][at] = edge.length; adjacencyEdgeId[a][at] = edge.id;
      }
    };
    link(edge.from, edge.to); link(edge.to, edge.from);
  };
  const linkSea = (a: number, b: number, cost: number): void => {
    const link = (from: number, to: number): void => {
      const at = seaAdjacency[from].indexOf(to);
      if (at < 0) { seaAdjacency[from].push(to); seaEdgeCost[from].push(cost); }
      else seaEdgeCost[from][at] = Math.min(seaEdgeCost[from][at], cost);
    };
    link(a, b); link(b, a);
  };

  if (canonical) for (const raw of canonical.edges) {
    if (raw.id !== edges.length) throw new Error('Canonical road edge ids must be dense and stable.');
    const edge: RoadGraphEdge = { ...raw };
    edges.push(edge);
    linkRoad(edge); // dotted visual roads are ordinary traversable roads
  }

  for (let offset = 0; offset + CONNECTION_STRIDE <= connections.length; offset += CONNECTION_STRIDE) {
    const medium = connections[offset + 4];
    if (medium !== MEDIUM_SEA && (!canonical && medium !== MEDIUM_LAND)) continue;
    const a = getNode(connections[offset], connections[offset + 1]);
    const b = getNode(connections[offset + 2], connections[offset + 3]);
    if (a === b) continue;
    const length = wrappedDistance(xs[a], zs[a], xs[b], zs[b], width) || GRAPH_CELL;
    if (medium === MEDIUM_SEA) {
      linkSea(a, b, length);
    } else {
      const pointOffset = centerlineValues.length / 2;
      centerlineValues.push(xs[a], zs[a], xs[b], zs[b]);
      const edge: RoadGraphEdge = {
        id: edges.length, from: a, to: b, length, pointOffset, pointCount: 2,
        dotted: connections[offset + 5] === 1,
      };
      edges.push(edge); linkRoad(edge);
    }
  }

  const { component, componentSize } = components(adjacency);
  return {
    nodeX: Float64Array.from(xs), nodeZ: Float64Array.from(zs), adjacency, edgeCost,
    adjacencyEdgeId, edges, centerlines: Float32Array.from(centerlineValues), component,
    componentSize, nodeCount: xs.length, width, height, seaAdjacency, seaEdgeCost,
  };
}

export function edgeIdBetween(graph: LandGraph, from: number, to: number): number {
  const index = graph.adjacency[from]?.indexOf(to) ?? -1;
  if (index < 0) return -1;
  // A few focused test/third-party fixtures predate canonical edge metadata.
  // Encode their directed pair without weakening generated-world authority.
  return graph.adjacencyEdgeId?.[from]?.[index]
    ?? 1_000_000_000 + from * graph.nodeCount + to;
}

function syntheticPair(graph: LandGraph, edgeId: number): { from: number; to: number } | null {
  if (edgeId < 1_000_000_000) return null;
  const value = edgeId - 1_000_000_000;
  return { from: Math.floor(value / graph.nodeCount), to: value % graph.nodeCount };
}

export function edgePosition(
  graph: LandGraph, edgeId: number, distanceFromEdgeStart: number,
): { x: number; z: number } {
  const edge = graph.edges?.[edgeId];
  if (!edge) {
    const pair = syntheticPair(graph, edgeId);
    if (!pair) return { x: NaN, z: NaN };
    const length = wrappedDistance(
      graph.nodeX[pair.from], graph.nodeZ[pair.from], graph.nodeX[pair.to], graph.nodeZ[pair.to], graph.width,
    );
    const t = length > 0 ? Math.max(0, Math.min(1, distanceFromEdgeStart / length)) : 0;
    let dx = graph.nodeX[pair.to] - graph.nodeX[pair.from];
    if (dx > graph.width / 2) dx -= graph.width;
    else if (dx < -graph.width / 2) dx += graph.width;
    return { x: wrapX(graph.nodeX[pair.from] + dx * t, graph.width),
      z: graph.nodeZ[pair.from] + (graph.nodeZ[pair.to] - graph.nodeZ[pair.from]) * t };
  }
  let remaining = Math.max(0, Math.min(edge.length, distanceFromEdgeStart));
  let ax = graph.centerlines[edge.pointOffset * 2];
  let az = graph.centerlines[edge.pointOffset * 2 + 1];
  for (let i = 1; i < edge.pointCount; i += 1) {
    let bx = graph.centerlines[(edge.pointOffset + i) * 2];
    const bz = graph.centerlines[(edge.pointOffset + i) * 2 + 1];
    let dx = bx - ax;
    if (dx > graph.width / 2) dx -= graph.width;
    else if (dx < -graph.width / 2) dx += graph.width;
    bx = ax + dx;
    const length = Math.hypot(dx, bz - az);
    if (remaining <= length || i === edge.pointCount - 1) {
      const t = length > 0 ? Math.min(1, remaining / length) : 0;
      return { x: wrapX(ax + dx * t, graph.width), z: az + (bz - az) * t };
    }
    remaining -= length;
    ax = bx; az = bz;
  }
  return { x: graph.nodeX[edge.to], z: graph.nodeZ[edge.to] };
}

export function edgePositionFrom(
  graph: LandGraph, edgeId: number, from: number, distanceAlongEdge: number,
): { x: number; z: number } {
  const edge = graph.edges?.[edgeId];
  const pair = edge ?? syntheticPair(graph, edgeId);
  const length = edge?.length ?? (pair ? wrappedDistance(
    graph.nodeX[pair.from], graph.nodeZ[pair.from], graph.nodeX[pair.to], graph.nodeZ[pair.to], graph.width,
  ) : 0);
  const canonicalDistance = pair?.from === from ? distanceAlongEdge : length - distanceAlongEdge;
  return edgePosition(graph, edgeId, canonicalDistance);
}

export function edgePolyline(
  graph: LandGraph, edgeId: number, from: number, startDistance = 0,
): Array<{ x: number; z: number }> {
  const edge = graph.edges?.[edgeId];
  if (!edge) {
    const pair = syntheticPair(graph, edgeId);
    if (!pair) return [];
    const points = from === pair.from ? [pair.from, pair.to] : [pair.to, pair.from];
    const result = points.map((node) => ({ x: graph.nodeX[node], z: graph.nodeZ[node] }));
    return startDistance > 0
      ? [edgePositionFrom(graph, edgeId, from, startDistance), result[1]] : result;
  }
  const points: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < edge.pointCount; i += 1) points.push({
    x: graph.centerlines[(edge.pointOffset + i) * 2],
    z: graph.centerlines[(edge.pointOffset + i) * 2 + 1],
  });
  if (from === edge.to) points.reverse();
  if (startDistance <= 0) return points;
  const start = edgePositionFrom(graph, edgeId, from, startDistance);
  let consumed = 0, index = 1;
  while (index < points.length) {
    const segment = wrappedDistance(points[index - 1].x, points[index - 1].z, points[index].x, points[index].z, graph.width);
    if (consumed + segment >= startDistance - 1e-6) break;
    consumed += segment; index += 1;
  }
  return [start, ...points.slice(index)];
}

/** Closest distance along an oriented centerline to a cached world position. */
export function edgeDistanceAtPoint(
  graph: LandGraph, edgeId: number, from: number, x: number, z: number,
): number {
  const points = edgePolyline(graph, edgeId, from);
  let bestDistance = 0, bestError = Infinity, consumed = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    let dx = points[i].x - a.x;
    if (dx > graph.width / 2) dx -= graph.width;
    else if (dx < -graph.width / 2) dx += graph.width;
    let px = x - a.x;
    if (px > graph.width / 2) px -= graph.width;
    else if (px < -graph.width / 2) px += graph.width;
    const dz = points[i].z - a.z;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, (px * dx + (z - a.z) * dz) / lengthSq)) : 0;
    const error = Math.hypot(px - dx * t, z - (a.z + dz * t));
    if (error < bestError) { bestError = error; bestDistance = consumed + Math.sqrt(lengthSq) * t; }
    consumed += Math.sqrt(lengthSq);
  }
  return bestDistance;
}

export function nearestNode(
  graph: LandGraph, x: number, z: number, maxDistance = Infinity, restrictComponent = -1,
): number {
  let best = -1;
  let bestDistSq = maxDistance * maxDistance;
  for (let id = 0; id < graph.nodeCount; id += 1) {
    if (restrictComponent >= 0 && graph.component[id] !== restrictComponent) continue;
    let dx = graph.nodeX[id] - x;
    if (dx > graph.width / 2) dx -= graph.width;
    else if (dx < -graph.width / 2) dx += graph.width;
    const dz = graph.nodeZ[id] - z;
    const distSq = dx * dx + dz * dz;
    if (distSq < bestDistSq) { bestDistSq = distSq; best = id; }
  }
  return best;
}

export function largestComponent(graph: LandGraph): number {
  let best = -1, bestSize = -1;
  for (let id = 0; id < graph.componentSize.length; id += 1) if (graph.componentSize[id] > bestSize) {
    best = id; bestSize = graph.componentSize[id];
  }
  return best;
}
