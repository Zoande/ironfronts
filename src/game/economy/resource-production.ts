import type { GameState, PhysicalResource, ProvinceEconomy } from '../game-state';
import type { SimContext } from '../sim-context';
import { nearestNode } from '../movement/graph';
import { baseUnitId, unitType } from '../units/unit-catalog';
import { unitStatMultiplier } from './shortages';
import {
  BUILDING_FOR_RESOURCE, effectiveEngineerCount, ENGINEER_PRODUCTION_PER_HOUR,
  maximumResourceTier, RESOURCE_TIER_ENGINEER_CAP, RESOURCE_TIER_ENGINEER_MULTIPLIER, RESOURCE_TIER_PASSIVE,
} from './resources';

export const OCCUPIED_OUTPUT_MULTIPLIER = 0.5;
export const engineerAssignmentKey = (provinceId: number, resource: PhysicalResource): string => `${provinceId}:${resource}`;

export function buildEngineerAssignmentIndex(ctx: SimContext): Map<string, number> {
  const result = new Map<string, number>();
  for (const army of Object.values(ctx.state.armies)) {
    const assignment = army.extractionAssignment;
    if (!assignment || army.status !== 'extracting' || army.order) continue;
    const province = ctx.world.provinces.find((item) => item.id === assignment.provinceId);
    if (!province || ctx.state.provinceOwners[province.id] !== army.ownerCountryId) continue;
    if (army.graphNodeId !== nearestNode(ctx.graph, province.center[0], province.center[1])) continue;
    const value = army.units.filter((item) => baseUnitId(item.typeId) === 'engineer').reduce((sum, group) =>
      sum + group.count * (unitType(group.typeId).extractionRate / ENGINEER_PRODUCTION_PER_HOUR)
        * unitStatMultiplier(unitType(group.typeId), 'extractionOutput', army.shortageSeverity), 0);
    if (!value) continue;
    const key = engineerAssignmentKey(province.id, assignment.resource);
    result.set(key, (result.get(key) ?? 0) + value);
  }
  return result;
}

export function engineersAssignedTo(
  ctx: SimContext, provinceId: number, resource: PhysicalResource,
): number {
  const assigned = Object.values(ctx.state.armies).filter((army) =>
    army.extractionAssignment?.provinceId === provinceId
      && army.extractionAssignment.resource === resource);
  if (assigned.length === 0) return 0;
  const province = ctx.world.provinces.find((item) => item.id === provinceId);
  if (!province) return 0;
  const centerNode = nearestNode(ctx.graph, province.center[0], province.center[1]);
  let engineers = 0;
  for (const army of assigned) {
    if (army.status !== 'extracting' || army.order || army.graphNodeId !== centerNode) continue;
    if (ctx.state.provinceOwners[provinceId] !== army.ownerCountryId) continue;
    engineers += army.units.filter((item) => baseUnitId(item.typeId) === 'engineer').reduce((sum, group) =>
      sum + group.count * (unitType(group.typeId).extractionRate / ENGINEER_PRODUCTION_PER_HOUR)
        * unitStatMultiplier(unitType(group.typeId), 'extractionOutput', army.shortageSeverity), 0);
  }
  return engineers;
}

export function physicalResourceOutput(
  ctx: SimContext, provinceId: number, resource: PhysicalResource, economy?: ProvinceEconomy,
  assignedEngineers?: number,
): number {
  return provinceResourceOutputBreakdown(ctx, provinceId, resource, economy, assignedEngineers).total;
}

export interface ProvinceResourceOutputBreakdown {
  base: number;
  passive: number;
  engineer: number;
  total: number;
  assignedEngineers: number;
  effectiveEngineers: number;
  currentTier: number;
  maximumTier: number;
}

export function provinceResourceOutputBreakdown(
  ctx: SimContext, provinceId: number, resource: PhysicalResource, economy?: ProvinceEconomy,
  assignedEngineerCount?: number,
): ProvinceResourceOutputBreakdown {
  const record = economy ?? ctx.state.provinceEconomies?.[provinceId];
  if (!record) return { base: 0, passive: 0, engineer: 0, total: 0, assignedEngineers: 0, effectiveEngineers: 0, currentTier: 0, maximumTier: 0 };
  const building = BUILDING_FOR_RESOURCE[resource];
  const tier = Math.max(0, Math.min(8, record.resourceBuildings[building] ?? 0));
  const engineers = assignedEngineerCount ?? engineersAssignedTo(ctx, provinceId, resource);
  const effective = effectiveEngineerCount(engineers, RESOURCE_TIER_ENGINEER_CAP[tier]);
  const owner = ctx.state.provinceOwners[provinceId];
  const originalOwner = ctx.world.provinceOwner(provinceId);
  const occupation = originalOwner !== 0 && owner !== originalOwner ? OCCUPIED_OUTPUT_MULTIPLIER : 1;
  const base = record.baseProduction[resource] * occupation;
  const passive = RESOURCE_TIER_PASSIVE[tier] * occupation;
  const engineer = effective * ENGINEER_PRODUCTION_PER_HOUR
    * RESOURCE_TIER_ENGINEER_MULTIPLIER[tier] * occupation;
  return { base, passive, engineer, total: base + passive + engineer,
    assignedEngineers: engineers, effectiveEngineers: effective, currentTier: tier,
    maximumTier: maximumResourceTier(building, record.resourcePotential[resource]) };
}

export function clearInvalidExtractionAssignments(ctx: SimContext): void {
  for (const army of Object.values(ctx.state.armies)) {
    const assignment = army.extractionAssignment;
    if (!assignment) continue;
    const province = ctx.world.provinces.find((item) => item.id === assignment.provinceId);
    const centerNode = province ? nearestNode(ctx.graph, province.center[0], province.center[1]) : -1;
    const valid = province && army.ownerCountryId === ctx.state.provinceOwners[assignment.provinceId]
      && army.graphNodeId === centerNode && !army.order
      && army.units.some((group) => baseUnitId(group.typeId) === 'engineer' && group.count > 0)
      && Boolean(ctx.state.provinceEconomies?.[assignment.provinceId]);
    if (!valid) {
      army.extractionAssignment = null;
      if (army.status === 'extracting') army.status = 'idle';
    }
  }
}

export function economyRecord(state: GameState, provinceId: number): ProvinceEconomy | undefined {
  return state.provinceEconomies?.[provinceId];
}
