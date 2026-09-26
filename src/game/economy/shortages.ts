import type { CountryState, GameState, Stockpile, UpkeepResource } from '../game-state';
import { emptyStockpile } from '../game-state';
import { unitType } from '../units/unit-catalog';

export const UPKEEP_RESOURCES: readonly UpkeepResource[] = ['funds', 'food', 'metal', 'oil'];
const GROWTH_PER_HOUR = 100 / 24;
const RECOVERY_PER_HOUR = 100 / 12;

export function ensureCountryEconomy(country: CountryState): void {
  country.upkeep ??= emptyStockpile();
  country.netIncome ??= emptyStockpile();
  country.coverage ??= { funds: 1, food: 1, metal: 1, oil: 1 };
  country.reserveHours ??= { funds: null, food: null, metal: null, oil: null };
  country.shortages ??= {
    funds: { severity: 0, notifiedThreshold: 0 }, food: { severity: 0, notifiedThreshold: 0 },
    metal: { severity: 0, notifiedThreshold: 0 }, oil: { severity: 0, notifiedThreshold: 0 },
  };
}

export function computeUpkeep(state: GameState): Map<number, Stockpile> {
  const result = new Map<number, Stockpile>();
  for (const country of Object.values(state.countries)) result.set(country.id, emptyStockpile());
  for (const army of Object.values(state.armies)) {
    const line = result.get(army.ownerCountryId);
    if (!line) continue;
    for (const group of army.units) {
      if (group.count <= 0) continue;
      const upkeep = unitType(group.typeId).upkeep;
      line.funds += group.count * (upkeep.fundsPerHour ?? 0);
      line.food += group.count * (upkeep.foodPerHour ?? 0);
      line.metal += group.count * (upkeep.metalPerHour ?? 0);
      line.oil += group.count * (upkeep.oilPerHour ?? 0);
    }
  }
  return result;
}

export function applyUpkeepAndShortages(state: GameState, dtHours: number): void {
  const upkeep = computeUpkeep(state);
  for (const country of Object.values(state.countries)) {
    ensureCountryEconomy(country);
    country.upkeep = upkeep.get(country.id) ?? emptyStockpile();
    for (const resource of UPKEEP_RESOURCES) {
      const demand = country.upkeep[resource] * dtHours;
      const paid = Math.min(country.stockpile[resource], demand);
      country.stockpile[resource] = Math.max(0, country.stockpile[resource] - paid);
      const coverage = demand > 0 ? paid / demand : 1;
      country.coverage![resource] = coverage;
      const shortage = country.shortages![resource];
      if (coverage < 1) shortage.severity = Math.min(100,
        shortage.severity + GROWTH_PER_HOUR * Math.pow(1 - coverage, 2) * dtHours);
      else shortage.severity = Math.max(0, shortage.severity - RECOVERY_PER_HOUR * dtHours);
      for (const threshold of [75, 50, 25] as const) {
        if (shortage.severity >= threshold && shortage.notifiedThreshold < threshold) {
          shortage.notifiedThreshold = threshold;
          break;
        }
      }
      while (shortage.notifiedThreshold > 0 && shortage.severity < shortage.notifiedThreshold - 5) {
        shortage.notifiedThreshold = shortage.notifiedThreshold === 75 ? 50
          : shortage.notifiedThreshold === 50 ? 25 : 0;
      }
      const net = country.income[resource] - country.upkeep[resource];
      country.netIncome![resource] = net;
      country.reserveHours![resource] = net < 0 ? country.stockpile[resource] / -net : null;
    }
    country.netIncome!.manpower = country.income.manpower;
    country.netIncome!.stone = country.income.stone;
  }
}
