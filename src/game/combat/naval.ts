/** Ship duels and very short-range coastal combat use the common five-class damage model. */
import type { SimContext } from '../sim-context';
import type { ArmyStack } from '../units/army';
import { combatDomain } from '../naval/transport';
import { relationOf } from '../game-state';
import { wrappedDistance } from '../geometry';
import { COMBAT_SNAP } from './constants';
import { mayInitiateCombat, revealFiringArmy } from './targeting';
import { addDamage, applyPendingDamage, calculateDamage, type PendingDamage } from './damage';
import type { CombatEvent } from './events';

export function stepNavalCombat(ctx: SimContext, dtHours: number, events: CombatEvent[]): Set<string> {
  const armies = Object.values(ctx.state.armies);
  for (const army of armies) army.navalCombatTargetArmyId = null;
  const targets = new Map<ArmyStack, ArmyStack>();
  const candidates = (army: ArmyStack): ArmyStack[] => armies.filter((other) => other !== army
    && (combatDomain(army) === 'naval' || combatDomain(other) === 'naval')
    && relationOf(ctx.state, army.ownerCountryId, other.ownerCountryId) === 'war'
    && !other.retreat?.protected && !army.retreat?.protected
    && army.status !== 'embarking' && other.status !== 'embarking'
    && !army.battleFrontIds?.length && !other.battleFrontIds?.length
    && wrappedDistance(army.x, army.z, other.x, other.z, ctx.world.width) <= COMBAT_SNAP)
    .sort((a, b) => Number(b.id === army.navalTargetArmyId) - Number(a.id === army.navalTargetArmyId)
      || wrappedDistance(army.x, army.z, a.x, a.z, ctx.world.width) - wrappedDistance(army.x, army.z, b.x, b.z, ctx.world.width)
      || a.id.localeCompare(b.id));
  for (const army of armies) {
    if (army.upgrade) continue;
    const target = candidates(army).find((other) => mayInitiateCombat(ctx, army, other));
    if (target) targets.set(army, target);
  }
  // A formation under attack returns fire, including a submarine ordered to hold.
  for (const [army, target] of [...targets]) {
    if (!targets.has(target) && !target.upgrade) targets.set(target, army);
  }
  const pending = new Map<string, PendingDamage>();
  const fired = new Set<string>();
  for (const [army, target] of targets) {
    const damage = calculateDamage([army], army.order?.intent === 'attack' || army.navalTargetArmyId === target.id ? 'attack' : 'defense', [target], dtHours);
    if (!damage.some((entry) => entry.amount > 0)) continue;
    army.navalCombatTargetArmyId = target.id;
    addDamage(pending, damage);
    revealFiringArmy(ctx, army);
    fired.add(army.id);
    if (ctx.state.simulationTick % 10 === 0) events.push({ kind: 'bombardment', attacker: army.ownerCountryId,
      defender: target.ownerCountryId, armyId: army.id, targetArmyId: target.id, x: target.x, z: target.z });
  }
  applyPendingDamage(pending);
  return fired;
}
