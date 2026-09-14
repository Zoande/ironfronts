/** Renewable province production assignment for engineer armies. */
import type { PhysicalResource } from './game-state';
import type { SimContext } from './sim-context';
import { nearestNode } from './movement/graph';
import { PHYSICAL_RESOURCES } from './economy/resources';
import { clearInvalidExtractionAssignments } from './economy/resource-production';
import { baseUnitId } from './units/unit-catalog';

export interface ExtractResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly provinceId?: number;
  readonly resources?: readonly PhysicalResource[];
}

function centerProvinceAtArmy(session: SimContext, graphNodeId: number, ownerCountryId: number): number | null {
  for (const province of session.world.provinces) {
    if (session.state.provinceOwners[province.id] !== ownerCountryId) continue;
    if (nearestNode(session.graph, province.center[0], province.center[1]) === graphNodeId) return province.id;
  }
  return null;
}

export function extractionEligibility(
  session: SimContext, armyId: string, resource?: PhysicalResource,
): ExtractResult {
  const army = session.state.armies[armyId];
  if (!army) return { ok: false, reason: 'No such army.' };
  if (army.status === 'engaged') return { ok: false, reason: 'Army is in close combat.' };
  if (army.status === 'retreating') return { ok: false, reason: 'Army is retreating.' };
  if (army.order) return { ok: false, reason: 'Army is moving.' };
  if (!army.units.some((group) => baseUnitId(group.typeId) === 'engineer' && group.count > 0)) {
    return { ok: false, reason: 'Engineers required.' };
  }
  const provinceId = centerProvinceAtArmy(session, army.graphNodeId, army.ownerCountryId);
  if (provinceId === null) return { ok: false, reason: 'Move to an owned province center.' };
  const economy = session.state.provinceEconomies?.[provinceId];
  if (!economy) return { ok: false, reason: 'Province economy unavailable.' };
  const resources = PHYSICAL_RESOURCES.filter((key) => economy.baseProduction[key] > 0);
  if (resource && !resources.includes(resource)) return { ok: false, reason: `No ${resource} production here.`, provinceId, resources };
  if (!resource) return resources.length
    ? { ok: true, provinceId, resources }
    : { ok: false, reason: 'No resource production here.', provinceId, resources };
  return { ok: true, provinceId, resources };
}

export function issueExtract(session: SimContext, armyId: string, resource?: PhysicalResource): ExtractResult {
  const eligible = extractionEligibility(session, armyId, resource);
  if (!eligible.ok || eligible.provinceId === undefined || !resource) return eligible;
  const army = session.state.armies[armyId]!;
  army.status = 'extracting';
  army.extractingNodeId = null;
  army.extractionAssignment = { provinceId: eligible.provinceId, resource };
  return { ok: true, provinceId: eligible.provinceId, resources: eligible.resources };
}

/** Extraction is folded into recomputed province income; this pass only validates assignments. */
export function stepExtraction(session: SimContext, _dtHours: number): void {
  clearInvalidExtractionAssignments(session);
}
