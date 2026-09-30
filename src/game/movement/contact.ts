import type { SpatialIndex } from '../spatial-index';
import type { SimContext } from '../sim-context';
import type { ArmyStack } from '../units/army';
import { relationOf } from '../game-state';
import { COMBAT_SNAP } from '../combat/constants';
import { edgePolyline } from './graph';
import { armiesInContact, canEnterCloseCombat } from '../combat/contact';

/** Swept contact along the canonical road centerline. The returned distance is
 * road distance, not the straight chord between the start and requested end. */
/** Also identifies the actual blocker so combat can account for approach time. */
export function sweptContact(
  ctx: SimContext, army: ArmyStack, edgeId: number, travelFrom: number,
  startDistance: number, limit: number, index?: SpatialIndex<ArmyStack>,
): { distance: number; armyId?: string } {
  if (!canEnterCloseCombat(army)) return { distance:limit };
  const wrap = (x: number): number => x > ctx.world.width / 2 ? x - ctx.world.width
    : x < -ctx.world.width / 2 ? x + ctx.world.width : x;
  const path = edgePolyline(ctx.graph, edgeId, travelFrom, startDistance, startDistance + limit);
  if (path.length < 2) return { distance:0 };
  let allowed = limit;
  let armyId: string | undefined;
  const candidates = index?.query(army.x, army.z, limit + COMBAT_SNAP)
    ?? Object.values(ctx.state.armies);
  for (const other of candidates) {
    if (other === army || !canEnterCloseCombat(other) || relationOf(ctx.state, army.ownerCountryId, other.ownerCountryId) !== 'war') continue;
    if (armiesInContact(army, other, ctx.world.width)) return { distance:0, armyId:other.id };
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
          const distance = consumed + Math.max(0, entry);
          if (distance <= allowed) { allowed = distance; armyId = other.id; }
        }
      }
      consumed += length;
    }
  }
  return { distance:allowed, armyId };
}
