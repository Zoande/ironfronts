/** Pure frontage selection, armor-pool damage, and pooled casualty application. */

import type { BattleRole } from '../game-state';
import type { ArmyStack, UnitGroup } from '../units/army';
import { unitType } from '../units/unit-catalog';
import type { ArmorClass, DamageProfile } from '../units/unit-types';
import { COMBAT_FRONTAGE } from './constants';

export interface GroupRef {
  readonly army: ArmyStack;
  readonly group: UnitGroup;
}

export interface PendingDamage {
  readonly army: ArmyStack;
  readonly group: UnitGroup;
  amount: number;
}

function armorHealth(armies: readonly ArmyStack[]): Record<ArmorClass, number> {
  const result: Record<ArmorClass, number> = { soft: 0, light: 0, heavy: 0 };
  for (const army of armies) {
    for (const group of army.units) result[unitType(group.typeId).armorClass] += group.hp;
  }
  return result;
}

function profileFor(role: BattleRole, group: UnitGroup): DamageProfile {
  const type = unitType(group.typeId);
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
  const total = hp.soft + hp.light + hp.heavy;
  if (total <= 0) return [];
  const ratio: Record<ArmorClass, number> = {
    soft: hp.soft / total, light: hp.light / total, heavy: hp.heavy / total,
  };
  const candidates: Array<{
    profile: DamageProfile;
    health: number;
    typeId: string;
    armyId: string;
    ordinal: number;
    score: number;
  }> = [];
  const pooledByType = new Map<string, { hp: number; maxHp: number }>();
  for (const army of attackers) {
    for (const group of army.units) {
      const pool = pooledByType.get(group.typeId) ?? { hp: 0, maxHp: 0 };
      pool.hp += group.hp;
      pool.maxHp += group.count * unitType(group.typeId).maxHp;
      pooledByType.set(group.typeId, pool);
    }
  }
  for (const army of attackers) {
    for (const group of army.units) {
      const pool = pooledByType.get(group.typeId)!;
      const health = pool.maxHp > 0 ? Math.max(0, Math.min(1, pool.hp / pool.maxHp)) : 0;
      const profile = profileFor(role, group);
      const score = health * (
        profile.soft * ratio.soft + profile.light * ratio.light + profile.heavy * ratio.heavy
      );
      for (let ordinal = 0; ordinal < group.count; ordinal += 1) {
        candidates.push({ profile, health, typeId: group.typeId, armyId: army.id, ordinal, score });
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score
    || a.typeId.localeCompare(b.typeId) || a.armyId.localeCompare(b.armyId)
    || a.ordinal - b.ordinal);
  const selected = candidates.slice(0, COMBAT_FRONTAGE);
  const fire: Record<ArmorClass, number> = { soft: 0, light: 0, heavy: 0 };
  for (const unit of selected) {
    fire.soft += unit.profile.soft * unit.health;
    fire.light += unit.profile.light * unit.health;
    fire.heavy += unit.profile.heavy * unit.health;
  }

  const result: Array<{ ref: GroupRef; amount: number }> = [];
  for (const armor of ['soft', 'light', 'heavy'] as const) {
    const classDamage = fire[armor] * ratio[armor] * Math.max(0, dtHours);
    if (classDamage <= 0 || hp[armor] <= 0) continue;
    for (const army of defenders) {
      for (const group of army.units) {
        if (unitType(group.typeId).armorClass !== armor) continue;
        result.push({ ref: { army, group }, amount: classDamage * group.hp / hp[armor] });
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
