import type { SimContext } from '../sim-context';
import type { ArmyStack } from '../units/army';
import { ensureArmyRuntimeState, stackUnitCount } from '../units/army';
import { unitType } from '../units/unit-catalog';
import { computeArmyVisibility } from '../visibility';
import { relationOf } from '../game-state';
import { wrappedDistance } from '../geometry';
import { addDamage, applyPendingDamage, calculateDamage, type GroupRef, type PendingDamage } from './damage';
import { removeArmyFromAllFronts } from './fronts';
import type { CombatEvent } from './events';
import { combatDomain } from '../naval/transport';

function artilleryDamage(
  army: ArmyStack, target: ArmyStack, dtHours: number,
): Array<{ ref: GroupRef; amount: number }> {
  const artilleryOnly: ArmyStack = {
    ...army,
    units: army.units.filter((group) => unitType(group.typeId).category === 'artillery'),
  };
  return calculateDamage([artilleryOnly], 'attack', [target], dtHours);
}

export function stepArtillery(session: SimContext, dtHours: number, events: CombatEvent[]): void {
  const armies = Object.values(session.state.armies);
  const pending = new Map<string, PendingDamage>();
  const countries = new Map<string, number>();
  const visibilityByCountry = new Map<number, ReturnType<typeof computeArmyVisibility>>();
  for (const army of armies) {
    ensureArmyRuntimeState(army);
    if (army.status !== 'idle' && army.status !== 'extracting') continue;
    const artillery = army.units.filter((group) => unitType(group.typeId).category === 'artillery');
    if (artillery.length === 0) continue;
    const range = Math.max(...artillery.map((group) => unitType(group.typeId).engagementRange));
    const visibility = visibilityByCountry.get(army.ownerCountryId)
      ?? computeArmyVisibility(session.state, session.world, army.ownerCountryId);
    visibilityByCountry.set(army.ownerCountryId, visibility);
    const validTargets = armies.filter((target) => target.id !== army.id
      && relationOf(session.state, army.ownerCountryId, target.ownerCountryId) === 'war'
      && combatDomain(target) === 'land'
      && !target.retreat?.protected
      && visibility.get(target.id) !== 'hidden'
      && wrappedDistance(army.x, army.z, target.x, target.z, session.world.width) <= range);
    let target = army.artillery!.manualTarget
      ? validTargets.find((candidate) => candidate.id === army.artillery!.targetArmyId)
      : undefined;
    if (!target) {
      army.artillery!.manualTarget = false;
      validTargets.sort((a, b) => wrappedDistance(
        army.x, army.z, a.x, a.z, session.world.width,
      ) - wrappedDistance(army.x, army.z, b.x, b.z, session.world.width) || a.id.localeCompare(b.id));
      target = validTargets[0];
      army.artillery!.targetArmyId = target?.id ?? null;
    }
    if (!target) continue;
    addDamage(pending, artilleryDamage(army, target, dtHours));
    countries.set(target.id, army.ownerCountryId);
    // Damage is continuous. The event is a presentation pulse only, sampled at
    // one real-time Hz so effects do not flood the client or event gateway.
    if (session.state.simulationTick % 10 === 0) {
      events.push({
        kind: 'bombardment', attacker: army.ownerCountryId, defender: target.ownerCountryId,
        armyId: army.id, targetArmyId: target.id, x: target.x, z: target.z,
      });
    }
  }
  applyPendingDamage(pending);
  for (const target of armies) {
    if (stackUnitCount(target) > 0) continue;
    removeArmyFromAllFronts(session, target.id);
    delete session.state.armies[target.id];
    events.push({ kind: 'destroyed', attacker: countries.get(target.id) ?? 0, defender: target.ownerCountryId,
      armyId: target.id, x: target.x, z: target.z });
  }
}

