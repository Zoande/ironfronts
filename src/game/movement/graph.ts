/**
 * Land movement graph (guardrail 2).
 *
 * Built at runtime from the already-loaded `connections.f32` buffer — no
 * build-pipeline change. Stride-8 records are `[x1, y1, x2, y2, medium, suppressed, 0, 0]`
 * where `medium === 1` means a LAND edge. Sea / ferry edges (`medium === 0`) are
 * excluded: a land army must never cross water just because the raw graph is
 * connected. Hidden / dotted connections live in a separate buffer and are not
 * present here at all.
 *
 * `suppressed === 1` marks a land edge whose corridor leaves the coastline
 * (`scripts/infrastructure/segment-audit.mjs`). Both its endpoints are still
 * registered as nodes — node ids and `nodeCount` are identical to an unaudited
 * build, so a live save's `army.graphNodeId` / `MoveOrder.path` stay valid —
 * but the edge is never linked, so pathfinding cannot route a land army across
 * it. A node reachable only by suppressed edges simply becomes its own
 * component (an unreachable islet), which pathfinding already reports as a
 * separate landmass.
 *
 * Endpoints are quantised to a grid cell to merge shared vertices (the source
 * `connection_segments.json` has real node ids, but the packed buffer drops
 * them). `CELL` matches the renderer's own junction-merge scale.
 *
 * Output is plain data with integer node ids, safe to reference from
 * `GameState` (army `graphNodeId`, resource `accessNodeId`).
 */

import { wrapX, wrappedDistance } from '../geometry';

/** World units; endpoints within one cell are treated as the same node. */
export const GRAPH_CELL = 20;

const CONNECTION_STRIDE = 8;
const MEDIUM_LAND = 1;
const EDGE_SUPPRESSED = 1;

export interface LandGraph {
  /** node id -> world X (wrapped into [0,width)). */
  readonly nodeX: Float64Array;
  /** node id -> world Z. */
  readonly nodeZ: Float64Array;
  /** node id -> [neighbourNodeId...]. */
  readonly adjacency: readonly number[][];
  /** node id -> edge cost to the matching entry in `adjacency`. */
  readonly edgeCost: readonly number[][];
  /** node id -> connected-component id. */
  readonly component: Int32Array;
  /** component id -> node count. */
  readonly componentSize: readonly number[];
  readonly nodeCount: number;
  readonly width: number;
  readonly height: number;
}

export function buildLandGraph(
  connections: Float32Array,
  width: number,
  height: number,
): LandGraph {
  const cellKey = (x: number, z: number): number => {
    const cx = Math.round(wrapX(x, width) / GRAPH_CELL);
    const cz = Math.round(z / GRAPH_CELL);
    // width/GRAPH_CELL < ~680, so 1e6 stride keeps keys unique.
    return cx * 1_000_000 + cz;
  };

  const idByKey = new Map<number, number>();
  const xs: number[] = [];
  const zs: number[] = [];
  const getNode = (x: number, z: number): number => {
    const key = cellKey(x, z);
    let id = idByKey.get(key);
    if (id === undefined) {
      id = xs.length;
      idByKey.set(key, id);
      xs.push(wrapX(x, width));
      zs.push(z);
    }
    return id;
  };

  const adjacency: number[][] = [];
  const edgeCost: number[][] = [];
  const linkOnce = (a: number, b: number, cost: number): void => {
    (adjacency[a] ??= []);
    (edgeCost[a] ??= []);
    const at = adjacency[a].indexOf(b);
    if (at === -1) {
      adjacency[a].push(b);
      edgeCost[a].push(cost);
    } else if (cost < edgeCost[a][at]) {
      edgeCost[a][at] = cost;
    }
  };

  for (let offset = 0; offset + CONNECTION_STRIDE <= connections.length; offset += CONNECTION_STRIDE) {
    if (connections[offset + 4] !== MEDIUM_LAND) continue;
    // Register both endpoints regardless of suppression so node ids stay
    // stable across an audited rebuild; only the linking is skipped.
    const a = getNode(connections[offset], connections[offset + 1]);
    const b = getNode(connections[offset + 2], connections[offset + 3]);
    if (a === b) continue;
    if (connections[offset + 5] === EDGE_SUPPRESSED) continue;
    const cost = wrappedDistance(xs[a], zs[a], xs[b], zs[b], width) || GRAPH_CELL;
    linkOnce(a, b, cost);
    linkOnce(b, a, cost);
  }

  const nodeCount = xs.length;
  for (let id = 0; id < nodeCount; id += 1) {
    adjacency[id] ??= [];
    edgeCost[id] ??= [];
  }

  const component = new Int32Array(nodeCount).fill(-1);
  const componentSize: number[] = [];
  const stack: number[] = [];
  for (let seed = 0; seed < nodeCount; seed += 1) {
    if (component[seed] !== -1) continue;
    const componentId = componentSize.length;
    component[seed] = componentId;
    stack.length = 0;
    stack.push(seed);
    let size = 0;
    while (stack.length > 0) {
      const current = stack.pop() as number;
      size += 1;
      for (const next of adjacency[current]) {
        if (component[next] === -1) {
          component[next] = componentId;
          stack.push(next);
        }
      }
    }
    componentSize.push(size);
  }

  return {
    nodeX: Float64Array.from(xs),
    nodeZ: Float64Array.from(zs),
    adjacency,
    edgeCost,
    component,
    componentSize,
    nodeCount,
    width,
    height,
  };
}

/** Nearest graph node to a world point, optionally restricted to one component.
 *  Returns -1 if nothing is within `maxDistance`. Linear scan — callers that do
 *  this in bulk at init should accept the O(n·m); the sim never calls it per
 *  tick. */
export function nearestNode(
  graph: LandGraph,
  x: number,
  z: number,
  maxDistance = Infinity,
  restrictComponent = -1,
): number {
  let best = -1;
  let bestDistSq = maxDistance * maxDistance;
  for (let id = 0; id < graph.nodeCount; id += 1) {
    if (restrictComponent >= 0 && graph.component[id] !== restrictComponent) continue;
    const dx = graph.nodeX[id] - x;
    const wrappedDx = dx > graph.width / 2 ? dx - graph.width
      : dx < -graph.width / 2 ? dx + graph.width : dx;
    const dz = graph.nodeZ[id] - z;
    const distSq = wrappedDx * wrappedDx + dz * dz;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = id;
    }
  }
  return best;
}

/** The id of the largest connected component (the "mainland" for a region). */
export function largestComponent(graph: LandGraph): number {
  let best = -1;
  let bestSize = -1;
  for (let id = 0; id < graph.componentSize.length; id += 1) {
    if (graph.componentSize[id] > bestSize) {
      bestSize = graph.componentSize[id];
      best = id;
    }
  }
  return best;
}
