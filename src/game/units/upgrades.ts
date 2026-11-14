/** Paid, persistent whole-army refits. No partial selection: split first. */
import type { SimContext } from '../sim-context';
import type { ArmyStack } from './army';
import type { ResourceCost } from './unit-types';
import { unitType } from './unit-catalog';
import { technologyLevels } from '../technology';
import type { CommandResult } from '../commands/types';

export interface ArmyUpgradeQuote {
  key: string;
  entries: Array<{ typeId: string; targetTypeId: string; count: number }>;
  cost: ResourceCost;
  totalHours: number;
  canStart: boolean;
  reason?: string;
}
export interface ArmyUpgrade {
  entries: ArmyUpgradeQuote['entries'];
  totalHours: number;
  remainingHours: number;
}

export function armyUpgradeQuote(ctx: Pick<SimContext, 'state'>, army: ArmyStack): ArmyUpgradeQuote {
  const country = ctx.state.countries[army.ownerCountryId];
  const tech = technologyLevels(country);
  const entries = army.units.flatMap((group) => {
    const type = unitType(group.typeId);
    const level = tech[type.technology];
    return level > type.level ? [{ typeId: type.id, targetTypeId: `${type.baseId}-l${level}`, count: group.count }] : [];
  });
  const cost: Record<string, number> = {};
  let totalHours = 0;
  for (const entry of entries) {
    const from = unitType(entry.typeId), to = unitType(entry.targetTypeId);
    // Existing personnel are retained. Refit materials are the incremental build cost.
    for (const resource of ['funds', 'food', 'metal', 'oil', 'stone'] as const) {
      const amount = Math.ceil(Math.max(0, (to.buildCost[resource] ?? 0) - (from.buildCost[resource] ?? 0)) * entry.count);
      if (amount) cost[resource] = (cost[resource] ?? 0) + amount;
    }
    totalHours = Math.max(totalHours, Math.max(0.5, (to.buildWork - from.buildWork) * 0.5));
  }
  const reason = army.upgrade ? 'This army is already upgrading.'
    : !entries.length ? 'All troops are at their highest researched level.'
    : (army.order || army.battleFrontIds?.length || !['idle', 'atSea'].includes(army.status) || army.transport)
      ? 'Stop the army and finish combat or transport before upgrading.'
      : Object.entries(cost).some(([resource, amount]) => !country || (country.stockpile as unknown as Record<string, number>)[resource] < amount)
        ? 'Insufficient resources for this refit.' : undefined;
  return { key: JSON.stringify(entries), entries, cost, totalHours, canStart: !reason, ...(reason ? { reason } : {}) };
}

export function startArmyUpgrade(ctx: SimContext, army: ArmyStack, quoteKey: string): CommandResult {
  const quote = armyUpgradeQuote(ctx, army);
  if (!quote.canStart) return { ok: false, reason: quote.reason };
  if (quote.key !== quoteKey) return { ok: false, reason: 'Troops or research changed. Review the updated upgrade quote.' };
  const country = ctx.state.countries[army.ownerCountryId];
  for (const [resource, amount] of Object.entries(quote.cost)) {
    (country.stockpile as unknown as Record<string, number>)[resource] -= amount ?? 0;
  }
  army.upgrade = { entries: quote.entries.map((entry) => ({ ...entry })), totalHours: quote.totalHours, remainingHours: quote.totalHours };
  army.queuedOrders = [];
  army.queuedOrderError = null;
  if (army.artillery) { army.artillery.targetArmyId = null; army.artillery.manualTarget = false; }
  return { ok: true };
}

export function stepArmyUpgrades(ctx: Pick<SimContext, 'state'>, dtHours: number): void {
  for (const army of Object.values(ctx.state.armies)) {
    if (!army.upgrade) continue;
    army.upgrade.remainingHours = Math.max(0, army.upgrade.remainingHours - Math.max(0, dtHours));
    if (army.upgrade.remainingHours > 1e-9) continue;
    const upgraded = army.units.map((group) => {
      const entry = army.upgrade!.entries.find((item) => item.typeId === group.typeId);
      if (!entry) return group;
      const fraction = group.hp / (group.count * unitType(group.typeId).maxHp);
      return { ...group, typeId: entry.targetTypeId, hp: fraction * group.count * unitType(entry.targetTypeId).maxHp };
    });
    // Multiple source levels can converge into the same destination type.
    const merged = new Map<string, typeof upgraded[number]>();
    for (const group of upgraded) {
      const previous = merged.get(group.typeId);
      if (!previous) merged.set(group.typeId, { ...group });
      else {
        previous.experience = (previous.experience * previous.count + group.experience * group.count) / (previous.count + group.count);
        previous.count += group.count; previous.hp += group.hp;
      }
    }
    army.units = [...merged.values()];
    army.upgrade = null;
  }
}
