import { armyAtNode } from './movement/position';
/**
 * Urban unit production.
 *
 * A player-owned urban province with the right building can queue units. Cost
 * is paid up front; the active order advances in game time; on completion the
 * unit spawns at the province's movement node and auto-stacks with any friendly
 * army already there.
 */

import type { SimContext } from './sim-context';
import type { ProductionOrder } from './game-state';
import type { BuildingId } from './units/unit-types';
import { BASE_UNIT_IDS, UNIT_TYPE_BY_ID, baseUnitId, unitType } from './units/unit-catalog';
import { technologyLevels } from './technology';
import { makeGroup, mergeStacks, type ArmyStack } from './units/army';
import { nearestNode } from './movement/graph';
import { issueMoveOrder } from './units/movement';


export interface ProduceResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly orderId?: string;
}

function buildingLevel(session: SimContext, provinceId: number, building: BuildingId): number {
  const b = session.state.provinceBuildings[provinceId];
  if (!b) return 0;
  return building === 'barracks' ? b.barracks
    : building === 'tankPlant' ? b.tankPlant
    : b.ordnance;
}

/** Unit work completed per real game hour by the required facility level. */
export const UNIT_PRODUCTION_RATE_BY_LEVEL = [0, 1, 1.3, 1.65, 2.05, 2.5, 3.1, 3.8, 4.7] as const;

export function unitProductionWorkRate(
  session: SimContext, provinceId: number, unitTypeId: string,
): number {
  const type = UNIT_TYPE_BY_ID.get(unitTypeId);
  if (!type) return 0;
  const level = Math.max(0, Math.min(8,
    session.state.provinceBuildings[provinceId]?.[type.requiredBuilding] ?? 0));
  const base = session.state.provinceEconomies?.[provinceId]?.productionCapacity ?? 1;
  return base * UNIT_PRODUCTION_RATE_BY_LEVEL[level];
}

/** Units `countryId` can produce in this province now. */
export function producibleUnits(
  session: SimContext, provinceId: number, countryId: number,
): string[] {
  if (session.state.provinceOwners[provinceId] !== countryId) return [];
  const out: string[] = [];
  const country = session.state.countries[countryId];
  const tech = technologyLevels(country);
  for (const baseId of BASE_UNIT_IDS) {
    const base = UNIT_TYPE_BY_ID.get(baseId)!;
    const level = Math.min(tech[base.technology], buildingLevel(session, provinceId, base.requiredBuilding));
    if (level > 0) out.push(level === 1 ? baseId : `${baseId}-l${level}`);
  }
  return out;
}

export function queueUnit(
  session: SimContext, provinceId: number, unitTypeId: string,
  countryId: number,
): ProduceResult {
  if (session.state.provinceOwners[provinceId] !== countryId) {
    return { ok: false, reason: 'Not your province.' };
  }
  const type = UNIT_TYPE_BY_ID.get(unitTypeId);
  if (!type) return { ok: false, reason: 'Unknown unit.' };
  const facilityLevel = buildingLevel(session, provinceId, type.requiredBuilding);
  if (facilityLevel < type.level) {
    return { ok: false, reason: `Requires a ${type.requiredBuilding}.` };
  }
  const country = session.state.countries[countryId];
  if (!country) return { ok: false, reason: 'Unknown country.' };
  if (technologyLevels(country)[type.technology] < type.level) {
    return { ok: false, reason: `Requires ${type.technology} technology Level ${type.level}.` };
  }
  const highestLevel = Math.min(technologyLevels(country)[type.technology], facilityLevel);
  const highestId = highestLevel === 1 ? type.baseId : `${type.baseId}-l${highestLevel}`;
  if (type.id !== highestId || baseUnitId(type.id) !== type.baseId) {
    return { ok: false, reason: 'Only the highest unlocked level may be trained.' };
  }
  for (const [key, amount] of Object.entries(type.buildCost)) {
    if ((country.stockpile as Record<string, number>)[key] < (amount ?? 0)) {
      return { ok: false, reason: `Not enough ${key}.` };
    }
  }
  for (const [key, amount] of Object.entries(type.buildCost)) {
    (country.stockpile as Record<string, number>)[key] -= amount ?? 0;
  }
  const order: ProductionOrder = {
    id: `ord-${session.state.nextOrderId}`,
    unitTypeId,
    ownerCountryId: countryId,
    progressWork: 0,
    totalWork: type.buildWork,
    progressHours: 0,
    totalHours: type.buildWork,
  };
  session.state.nextOrderId += 1;
  (session.state.productionQueues[provinceId] ??= []).push(order);
  return { ok: true, orderId: order.id };
}

export interface UnitCompletion {
  readonly provinceId: number;
  readonly unitTypeId: string;
  readonly armyId: string;
  readonly ownerCountryId: number;
}

/** Advance every queue; returns units finished this tick (for notifications). */
export function stepProduction(session: SimContext, dtHours: number): UnitCompletion[] {
  const completed: UnitCompletion[] = [];
  for (const [pidStr, queue] of Object.entries(session.state.productionQueues)) {
    const provinceId = Number(pidStr);
    // Drop any leading orders whose paying country no longer owns the province
    // (captured since it was queued). Cost is forfeit — v1 rule.
    while (queue.length > 0 && session.state.provinceOwners[provinceId] !== queue[0].ownerCountryId) {
      queue.shift();
    }
    if (queue.length === 0) continue;
    let remainingHours = dtHours;
    while (queue.length > 0 && remainingHours > 1e-12) {
    const active = queue[0];
    if (active.ownerCountryId !== session.state.provinceOwners[provinceId]) { queue.shift(); continue; }
    const rate = unitProductionWorkRate(session, provinceId, active.unitTypeId);
    if (rate <= 0) break;
    const total = active.totalWork ?? active.totalHours ?? 1;
    const progress = active.progressWork ?? active.progressHours ?? 0;
    const used = Math.min(remainingHours * rate, Math.max(0, total - progress));
    active.progressWork = progress + used;
    active.progressHours = active.progressWork;
    remainingHours -= used / rate;
    if (active.progressWork + 1e-12 < total) break;

    queue.shift();
    const armyId = spawnUnit(session, provinceId, active.unitTypeId, active.ownerCountryId);
    completed.push({ provinceId, unitTypeId: active.unitTypeId, armyId, ownerCountryId: active.ownerCountryId });

    // Rally point: march the fresh unit (or the idle stack it joined) toward it.
    const rally = session.state.rallyPoints[provinceId];
    const army = session.state.armies[armyId];
    if (rally && army && !army.order && army.status === 'idle') {
      issueMoveOrder(session, armyId, rally.x, rally.z, 'move');
    }
  }
  }
  // Drop empty queues so the record stays sparse.
  for (const [pid, queue] of Object.entries(session.state.productionQueues)) {
    if (queue.length === 0) delete session.state.productionQueues[Number(pid)];
  }
  return completed;
}

function spawnUnit(
  session: SimContext, provinceId: number, unitTypeId: string, ownerCountryId: number,
): string {
  const world = session.world;
  const province = world.provinces.find((p) => p.id === provinceId);
  const [cx, cz] = province ? province.center : [world.width / 2, world.height / 2];
  // Uncapped: the nearest land node to the city, however far. A 500u cap used to
  // fail for cities set back from the road graph and fall back to node 0 — a
  // real node elsewhere on the map, which made pathfinding place the new stack
  // in the wrong place entirely.
  const node = nearestNode(session.graph, cx, cz);
  const nx = node >= 0 ? session.graph.nodeX[node] : cx;
  const nz = node >= 0 ? session.graph.nodeZ[node] : cz;

  // Auto-stack onto a friendly idle army already at that node.
  const existing = Object.values(session.state.armies)
    .filter((a) => a.ownerCountryId === ownerCountryId
      && armyAtNode(session, a, node) && a.graphNodeId === node && !a.order && a.extractionAssignment == null
      && a.status !== 'engaged' && a.status !== 'retreating')
    .sort((a, b) => {
      const an = Number(a.id.replace(/^army-/, ''));
      const bn = Number(b.id.replace(/^army-/, ''));
      return (Number.isFinite(an) ? an : Number.MAX_SAFE_INTEGER)
        - (Number.isFinite(bn) ? bn : Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id);
    })[0];
  const group = makeGroup(unitTypeId, 1);
  if (existing) {
    const fresh: ArmyStack = {
      id: 'tmp', ownerCountryId, name: 'tmp',
      x: nx, z: nz, graphNodeId: node, units: [group],
      status: 'idle', order: null, extractingNodeId: null,
      extractionAssignment: null,
    };
    mergeStacks(existing, fresh);
    return existing.id;
  }
  const id = `army-${session.state.nextArmyId}`;
  session.state.nextArmyId += 1;
  session.state.armies[id] = {
    id,
    ownerCountryId,
    name: `${unitType(unitTypeId).name} Detachment`,
    x: nx,
    z: nz,
    graphNodeId: node >= 0 ? node : 0,
    units: [group],
    status: 'idle',
    order: null,
    extractingNodeId: null,
    extractionAssignment: null,
  };
  return id;
}
