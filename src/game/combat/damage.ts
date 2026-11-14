import { activeTransportStats, combatDomain, damageTransportCargo } from '../naval/transport';
/** Pure frontage selection, armor-pool damage, and pooled casualty application. */

import type { BattleRole } from '../game-state';
import type { ArmyStack, UnitGroup } from '../units/army';
import { unitType } from '../units/unit-catalog';
import type { ArmorClass, DamageProfile } from '../units/unit-types';
import { COMBAT_FRONTAGE, MIN_COMBAT_EFFECTIVENESS } from './constants';
import { stanceModifiers } from './stance';
import { supplyEffectiveness } from './supply';

export interface GroupRef {
  readonly army: ArmyStack;
  readonly group: UnitGroup;
}

export interface PendingDamage {
  readonly army: ArmyStack;
  readonly group: UnitGroup;
  amount: number;
}

const ARMOR_CLASSES = ['soft', 'light', 'heavy', 'ship', 'submarine'] as const;
function groupArmor(army: ArmyStack, group: UnitGroup): ArmorClass {
  return combatDomain(army) === 'naval' && army.transport ? 'ship' : unitType(group.typeId).armorClass;
}
function combatHp(army: ArmyStack, group: UnitGroup): number {
  return combatDomain(army) === 'naval' && army.transport
    ? army.transport.cargo.find((cargo) => cargo.cargoTypeId === group.typeId)?.shipHp.reduce((sum, hp) => sum + hp, 0) ?? 0
    : group.hp;
}
function combatMaxHp(army: ArmyStack, group: UnitGroup): number {
  return group.count * ((combatDomain(army) === 'naval' ? activeTransportStats(army)?.maxHp : undefined) ?? unitType(group.typeId).maxHp);
}
function armorHealth(armies: readonly ArmyStack[]): Record<ArmorClass, number> {
  const result: Record<ArmorClass, number> = { soft: 0, light: 0, heavy: 0, ship: 0, submarine: 0 };
  for (const army of armies) {
    for (const group of army.units) result[groupArmor(army, group)] += combatHp(army, group);
  }
  return result;
}

function profileFor(army: ArmyStack, role: BattleRole, group: UnitGroup): DamageProfile {
  const type = (combatDomain(army) === 'naval' ? activeTransportStats(army) : null) ?? unitType(group.typeId);
  return role === 'attack' ? type.attack : type.defense;
}

/**
 * Rank individual candidates by expected output and return proportional damage
 * against every target group. Overflow strength remains in the HP pools but
 * contributes no firepower.
 */
export function calculateDamage(
  attackers: readonly ArmyStack[], role: BattleRole, defenders: readonly ArmyStack[], dtHours: number,
): Array<{ ref: GroupRef; amount: number }> {
  const hp = armorHealth(defenders);
  const total = ARMOR_CLASSES.reduce((sum, armor) => sum + hp[armor], 0);
  if (total <= 0) return [];
  const ratio: Record<ArmorClass, number> = {
    soft: hp.soft / total, light: hp.light / total, heavy: hp.heavy / total, ship: hp.ship / total, submarine: hp.submarine / total,
  };
  const candidates: Array<{
    profile: DamageProfile;
    health: number;
    outputFactor: number;
    typeId: string;
    armyId: string;
    ordinal: number;
    score: number;
  }> = [];
  const pooledByType = new Map<string, { hp: number; maxHp: number }>();
  for (const army of attackers) {
    for (const group of army.units) {
      const pool = pooledByType.get(group.typeId) ?? { hp: 0, maxHp: 0 };
      pool.hp += combatHp(army, group);
      pool.maxHp += combatMaxHp(army, group);
      pooledByType.set(group.typeId, pool);
    }
  }
  for (const army of attackers) {
    for (const group of army.units) {
      const pool = pooledByType.get(group.typeId)!;
      const health = pool.maxHp > 0 ? Math.max(MIN_COMBAT_EFFECTIVENESS, Math.min(1, pool.hp / pool.maxHp)) : 0;
      const outputFactor = stanceModifiers(army.stance).attackOutput * supplyEffectiveness(army);
      const profile = profileFor(army, role, group);
      const score = health * outputFactor * (
        ARMOR_CLASSES.reduce((sum, armor) => sum + (profile[armor] ?? 0) * ratio[armor], 0)
      );
      for (let ordinal = 0; ordinal < Math.min(group.count, COMBAT_FRONTAGE); ordinal += 1) {
        candidates.push({ profile, health, outputFactor, typeId: group.typeId, armyId: army.id, ordinal, score });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score
    || a.typeId.localeCompare(b.typeId) || a.armyId.localeCompare(b.armyId)
    || a.ordinal - b.ordinal);
  const selected = candidates.slice(0, COMBAT_FRONTAGE);
  const fire: Record<ArmorClass, number> = { soft: 0, light: 0, heavy: 0, ship: 0, submarine: 0 };
  for (const unit of selected) {
    for (const armor of ARMOR_CLASSES) fire[armor] += (unit.profile[armor] ?? 0) * unit.health * unit.outputFactor;
  }

  // A ten-unit frontage adds firepower sublinearly; equal large forces take longer.
  const coordination = 1 / Math.sqrt(Math.max(1, selected.length));
  const result: Array<{ ref: GroupRef; amount: number }> = [];
  for (const armor of ARMOR_CLASSES) {
    const classDamage = fire[armor] * coordination * ratio[armor] * Math.max(0, dtHours);
    if (classDamage <= 0 || hp[armor] <= 0) continue;
    for (const army of defenders) {
      const protectionFactor = stanceModifiers(army.stance).damageTaken
        / supplyEffectiveness(army); // low supply weakens defense as well as output
      for (const group of army.units) {
        if (groupArmor(army, group) !== armor) continue;
        result.push({ ref: { army, group }, amount: classDamage * combatHp(army, group) / hp[armor] * protectionFactor });
      }
    }
  }
  return result;
}

export function addDamage(
  pending: Map<string, PendingDamage>,
  entries: readonly { ref: GroupRef; amount: number }[],
): void {
  for (const entry of entries) {
    const key = `${entry.ref.army.id}\0${entry.ref.group.typeId}`;
    const item = pending.get(key);
    if (item) item.amount += entry.amount;
    else pending.set(key, { ...entry.ref, amount: entry.amount });
  }
}

/** Apply a simultaneous damage map and coherently shed pooled unit counts. */
export function applyPendingDamage(pending: ReadonlyMap<string, PendingDamage>): void {
  const unnormalized = new Set<string>();
  for (const item of pending.values()) {
    if (item.army.transport) {
      const amount = combatDomain(item.army) === 'naval' ? item.amount
        : item.amount * activeTransportStats(item.army)!.maxHp / unitType(item.group.typeId).maxHp;
      damageTransportCargo(item.army, item.group.typeId, amount); continue;
    }
    item.group.hp = Math.max(0, item.group.hp - item.amount);
    unnormalized.add(item.army.id);
  }
  for (const item of pending.values()) {
    if (!unnormalized.delete(item.army.id)) continue;
    item.army.units = item.army.units.filter((group) => {
      const maxHp = unitType(group.typeId).maxHp;
      group.count = Math.max(0, Math.min(group.count, Math.ceil(group.hp / maxHp)));
      return group.count > 0 && group.hp > 0;
    });
  }
}
