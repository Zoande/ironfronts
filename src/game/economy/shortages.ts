import type { CountryState, GameState, Stockpile, UpkeepResource } from '../game-state';
import { emptyStockpile } from '../game-state';
import type { ArmyStack } from '../units/army';
import { unitType } from '../units/unit-catalog';
import type { UnitStat, UnitType } from '../units/unit-types';

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
  for (const army of Object.values(state.armies)) {
    const cap = stackOrganizationCap(army);
    army.organization = Math.min(army.organization ?? 100, cap);
  }
}

function curveValue(curve: 'linear' | 'soft' | 'late' | undefined, x: number): number {
  return curve === 'soft' ? x * x : curve === 'late' ? x ** 4 : x;
}

export function unitStatMultiplier(
  type: UnitType, stat: UnitStat, severity: Partial<Record<UpkeepResource, number>> | undefined,
): number {
  let multiplier = 1;
  for (const effect of type.shortageEffects) {
    if (effect.stat !== stat) continue;
    const x = Math.max(0, Math.min(1, (severity?.[effect.resource] ?? 0) / 100));
    multiplier *= 1 - effect.maxPenalty * curveValue(effect.curve, x);
  }
  return Math.max(0.05, multiplier);
}

export function stackOrganizationCap(army: ArmyStack): number {
  let weighted = 0;
  let maxHp = 0;
  for (const group of army.units) {
    const type = unitType(group.typeId);
    const weight = group.count * type.maxHp;
    weighted += 100 * unitStatMultiplier(type, 'organizationCap', army.shortageSeverity) * weight;
    maxHp += weight;
  }
  return maxHp > 0 ? weighted / maxHp : 100;
}

export function armyShortageSummary(army: ArmyStack): Record<UnitStat, number> {
  let hp = 0;
  let combat = 0;
  let extraction = 0;
  let engineers = 0;
  let baseSpeed = Infinity;
  let adjustedSpeed = Infinity;
  let baseVision = 0;
  let adjustedVision = 0;
  for (const group of army.units) {
    if (group.count <= 0) continue;
    const type = unitType(group.typeId);
    const weight = group.count * type.maxHp;
    hp += weight;
    combat += weight * unitStatMultiplier(type, 'combatOutput', army.shortageSeverity);
    baseSpeed = Math.min(baseSpeed, type.speed);
    adjustedSpeed = Math.min(adjustedSpeed, type.speed * unitStatMultiplier(type, 'movementSpeed', army.shortageSeverity));
    baseVision = Math.max(baseVision, type.visionOuter);
    adjustedVision = Math.max(adjustedVision, type.visionOuter * unitStatMultiplier(type, 'visionRange', army.shortageSeverity));
    if (type.id === 'engineer') {
      engineers += group.count;
      extraction += group.count * unitStatMultiplier(type, 'extractionOutput', army.shortageSeverity);
    }
  }
  return {
    combatOutput: hp > 0 ? combat / hp : 1,
    movementSpeed: Number.isFinite(baseSpeed) && baseSpeed > 0 ? adjustedSpeed / baseSpeed : 1,
    visionRange: baseVision > 0 ? adjustedVision / baseVision : 1,
    extractionOutput: engineers > 0 ? extraction / engineers : 1,
    organizationCap: stackOrganizationCap(army) / 100,
  };
}
