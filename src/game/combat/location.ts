import type { SimContext } from '../sim-context';

/** Province spatially containing a graph node. */
export function provinceAtNode(session: SimContext, nodeId: number): number | null {
  if (nodeId < 0 || nodeId >= session.graph.nodeCount) return null;
  return provinceAtPoint(session, session.graph.nodeX[nodeId], session.graph.nodeZ[nodeId]);
}

/** Province spatially containing an authoritative world-space contact point. */
export function provinceAtPoint(session: SimContext, x: number, z: number): number | null {
  const provinceId = session.world.provinceAt(x, z);
  return provinceId >= 0 ? provinceId : null;
}
