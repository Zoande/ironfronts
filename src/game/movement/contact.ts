import type { SpatialIndex } from '../spatial-index';
import type { SimContext } from '../sim-context';
import type { ArmyStack } from '../units/army';
import { relationOf } from '../game-state';
import { COMBAT_SNAP } from '../combat/constants';
import { edgePolyline } from './graph';

/** Swept contact along the canonical road centerline. The returned distance is
 * road distance, not the straight chord between the start and requested end. */
export function contactDistance(
  ctx: SimContext, army: ArmyStack, edgeId: number, travelFrom: number,
  startDistance: number, limit: number, index?: SpatialIndex<ArmyStack>,
): number {
  if (army.retreat?.protected) return limit;
  const wrap = (x: number): number => x > ctx.world.width / 2 ? x - ctx.world.width
    : x < -ctx.world.width / 2 ? x + ctx.world.width : x;
  const path = edgePolyline(ctx.graph, edgeId, travelFrom, startDistance, startDistance + limit);
  if (path.length < 2) return 0;
  let allowed = limit;
  const candidates = index?.query(army.x, army.z, limit + COMBAT_SNAP)
    ?? Object.values(ctx.state.armies);
  for (const other of candidates) {
    if (other === army || other.retreat?.protected || relationOf(ctx.state, army.ownerCountryId, other.ownerCountryId) !== 'war') continue;
    if (Math.hypot(wrap(other.x - army.x), other.z - army.z) <= COMBAT_SNAP) return 0;
    let consumed = 0;
    for (let i = 1; i < path.length && consumed < allowed; i += 1) {
      const a = path[i - 1];
      const dx = wrap(path[i].x - a.x), dz = path[i].z - a.z;
      const length = Math.hypot(dx, dz);
      if (length <= 1e-9) continue;
      const ux = dx / length, uz = dz / length;
      const ox = wrap(other.x - a.x), oz = other.z - a.z;
      const projected = ox * ux + oz * uz;
      const perpendicularSq = Math.max(0, ox * ox + oz * oz - projected * projected);
      const radiusSq = COMBAT_SNAP * COMBAT_SNAP;
      if (perpendicularSq <= radiusSq) {
        const root = Math.sqrt(radiusSq - perpendicularSq);
        const entry = projected - root;
        const exit = projected + root;
        if (exit >= 0 && entry <= length) {
          allowed = Math.min(allowed, consumed + Math.max(0, entry));
        }
      }
      consumed += length;
    }
  }
  return allowed;
}
