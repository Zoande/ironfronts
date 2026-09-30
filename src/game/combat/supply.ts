/**
 * Supply: connected armies refill one reserve; disconnected armies consume it.
 * Low reserves apply the same tiered penalty to combat and field operations.
 */
import type { SimContext } from '../sim-context';
import type { CountryState, UpkeepResource } from '../game-state';
import type { ArmyStack } from '../units/army';
import { ensureArmyRuntimeState, stackUnitCount, SUPPLY_CAPACITY_PER_UNIT } from '../units/army';
import { unitType } from '../units/unit-catalog';
import { nearestNode } from '../movement/graph';
import { UPKEEP_RESOURCES } from '../economy/shortages';

/** Capacity per unit and local graph search radius for a supply route. */
export { SUPPLY_CAPACITY_PER_UNIT } from '../units/army';
/** Compatibility radius for callers that use it as a local-world probe limit. */
export const SUPPLY_RANGE = 1800;
export interface ArmySupplyPlan {
  readonly capacity: number;
  readonly upkeepPerHour: number;
}

export function armySupplyPlan(army: ArmyStack): ArmySupplyPlan {
  let upkeepPerHour = 0;
  for (const group of army.units) {
    const unit = unitType(group.typeId);
    upkeepPerHour += group.count * ((unit.upkeep.fundsPerHour ?? 0)
      + (unit.upkeep.foodPerHour ?? 0) + (unit.upkeep.metalPerHour ?? 0)
      + (unit.upkeep.oilPerHour ?? 0));
  }
  const capacity = army.units.reduce((total, group) => total + group.count * SUPPLY_CAPACITY_PER_UNIT, 0);
  return { capacity, upkeepPerHour };
}

export function supplyFraction(army: ArmyStack): number {
  const capacity = stackUnitCount(army) * SUPPLY_CAPACITY_PER_UNIT;
  return capacity > 0 ? Math.max(0, Math.min(1, (army.supply ?? capacity) / capacity)) : 1;
}

/** One multiplier for every army activity affected by low supply. */
export function supplyEffectiveness(army: ArmyStack): number {
  const fraction = supplyFraction(army);
  if (fraction >= 0.75) return 1;
  if (fraction >= 0.5) return 0.9;
  if (fraction >= 0.25) return 0.75;
  if (fraction > 0) return 0.6;
  return 0.4;
}

/** Only an empty reserve with a negative net flow slows replenishment. */
export function supplyShortfalls(country: CountryState | undefined): UpkeepResource[] {
  if (!country) return [];
  return UPKEEP_RESOURCES.filter((resource) => country.stockpile[resource] <= 0
    && (country.netIncome?.[resource] ?? country.income[resource] - (country.upkeep?.[resource] ?? 0)) < 0);
}

export function supplyRefillMultiplier(country: CountryState | undefined): number {
  return 1 - supplyShortfalls(country).length * 0.2;
}

function connectedToSupply(ctx: SimContext, army: ArmyStack): boolean {
  const owner = army.ownerCountryId;
  const capital = ctx.world.countries.find((country) => country.id === owner)?.capitalProvinceId;
  if (capital === undefined) return false;
  const sourceNode = nearestNode(ctx.graph, army.x, army.z, SUPPLY_RANGE,
    army.graphNodeId >= 0 ? ctx.graph.component[army.graphNodeId] ?? -1 : -1);
  if (sourceNode < 0) return false;
  const targets = new Set<number>();
  if (ctx.state.provinceOwners[capital] === owner) targets.add(capital);
  for (const province of ctx.world.provinces) {
    if (province.coastal) targets.add(province.id);
  }
  const sourceProvince = ctx.world.provinceAt(ctx.graph.nodeX[sourceNode], ctx.graph.nodeZ[sourceNode]);
  const sourceForeign = sourceProvince >= 0 && ctx.state.provinceOwners[sourceProvince] !== owner ? 1 : 0;
  const queue: Array<[number, number]> = [[sourceNode, sourceForeign]];
  const visited = new Set<string>();
  while (queue.length) {
    const [node, foreign] = queue.shift()!;
    const key = `${node}:${foreign}`;
    if (visited.has(key)) continue;
    visited.add(key);
    const province = ctx.world.provinceAt(ctx.graph.nodeX[node], ctx.graph.nodeZ[node]);
    if (targets.has(province)) return true;
    for (const next of ctx.graph.adjacency[node] ?? []) {
      const nextProvince = ctx.world.provinceAt(ctx.graph.nodeX[next], ctx.graph.nodeZ[next]);
      const crossedForeign = nextProvince >= 0 && ctx.state.provinceOwners[nextProvince] !== owner ? 1 : 0;
      const nextForeign = Math.min(2, foreign + (nextProvince !== province ? crossedForeign : 0));
      if (nextForeign <= 1) queue.push([next, nextForeign]);
    }
  }
  return false;
}

export function stepSupply(ctx: SimContext, dtHours = 0): void {
  for (const army of Object.values(ctx.state.armies)) {
    ensureArmyRuntimeState(army);
    const plan = armySupplyPlan(army);
    army.supplyCapacity = plan.capacity;
    const connected = connectedToSupply(ctx, army);
    army.inSupply = connected;
    const current = Math.max(0, Math.min(plan.capacity, army.supply ?? plan.capacity));
    army.supply = connected
      ? Math.min(plan.capacity, current + plan.capacity * Math.max(0, dtHours) * supplyRefillMultiplier(ctx.state.countries[army.ownerCountryId]))
      : Math.max(0, current - plan.upkeepPerHour * Math.max(0, dtHours));
  }
}
