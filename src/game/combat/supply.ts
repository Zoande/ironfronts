/**
 * Supply: an army far from its own country's territory fights, holds, and
 * moves worse. Deliberately a straight-line-distance approximation rather
 * than a road-network calculation — cheap enough to recompute for every
 * army on a slow cadence (see SUPPLY_RECOMPUTE_INTERVAL in game-session.ts)
 * without a full graph search, at the cost of not modelling supply lines
 * being cut by an encirclement along the roads themselves. Good enough to
 * make deep unsupported offensives costly, which is the actual ask.
 */
import type { SimContext } from '../sim-context';
import type { UpkeepResource } from '../game-state';
import type { ArmyStack } from '../units/army';
import { ensureArmyRuntimeState } from '../units/army';
import { unitType } from '../units/unit-catalog';
import { nearestNode } from '../movement/graph';

/** World-space reach of a country's own territory before a stack is
 *  considered out of supply. Calibrated relative to MISSILE_RANGE (3200) —
 *  comfortably covers pushing one or two provinces past the border, not an
 *  unsupported drive across the map. */
export const SUPPLY_CAPACITY_PER_UNIT = 100;
/** Compatibility radius for callers that use it as a local-world probe limit. */
export const SUPPLY_RANGE = 1800;
const SUPPLY_RESOURCES: readonly UpkeepResource[] = ['funds', 'food', 'metal', 'oil'];

export interface ArmySupplyPlan {
  readonly capacity: number;
  readonly allocation: Record<UpkeepResource, number>;
  readonly upkeep: Record<UpkeepResource, number>;
}

export function armySupplyPlan(army: ArmyStack): ArmySupplyPlan {
  const upkeep = { funds: 0, food: 0, metal: 0, oil: 0 };
  for (const group of army.units) {
    const unit = unitType(group.typeId);
    upkeep.funds += group.count * (unit.upkeep.fundsPerHour ?? 0);
    upkeep.food += group.count * (unit.upkeep.foodPerHour ?? 0);
    upkeep.metal += group.count * (unit.upkeep.metalPerHour ?? 0);
    upkeep.oil += group.count * (unit.upkeep.oilPerHour ?? 0);
  }
  const capacity = army.units.reduce((total, group) => total + group.count * SUPPLY_CAPACITY_PER_UNIT, 0);
  const totalUpkeep = Object.values(upkeep).reduce((sum, value) => sum + value, 0);
  const allocation = Object.fromEntries(SUPPLY_RESOURCES.map((resource) => [
    resource, totalUpkeep > 0 ? capacity * upkeep[resource] / totalUpkeep : 0,
  ])) as Record<UpkeepResource, number>;
  return { capacity, allocation, upkeep };
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
    for (const resource of SUPPLY_RESOURCES) {
      const maximum = plan.allocation[resource];
      const current = Number(army.supplyStores?.[resource] ?? maximum);
      army.supplyStores![resource] = connected
        ? maximum
        : Math.max(0, current - plan.upkeep[resource] * dtHours);
      army.shortageSeverity![resource] = maximum > 0 && army.supplyStores![resource] <= 0 ? 100 : 0;
    }
  }
}
