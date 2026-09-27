/** Authoritative combat phase; subsystems share stable front membership. */
import type { SimContext } from './sim-context';
import type { BattleFrontState, BattleRole } from './game-state';
import { stackUnitCount, type ArmyStack } from './units/army';
import { addDamage, applyPendingDamage, calculateDamage, type GroupRef, type PendingDamage } from './combat/damage';
import { initializeState, detectEngagements, sideArmies, removeArmyFromAllFronts, cleanupFronts } from './combat/fronts';
import {
  COMBAT_FRONTAGE, DEVASTATED_DEFENDER_STRENGTH_MULTIPLIER,
} from './combat/constants';
import { autoRetreat } from './combat/retreat';
import { stepArtillery } from './combat/artillery';
import { terrainDefenseMultiplier } from './combat/terrain';
import { stanceModifiers } from './combat/stance';
import { supplyEffectiveness } from './combat/supply';
import type { CombatEvent } from './combat/events';
export type { CombatEvent } from './combat/events';
export { COMBAT_FRONTAGE } from './combat/constants';
export { stepCapture, type CaptureEvent } from './combat/capture';
export { legalRetreatPaths, issueManualRetreat } from './combat/retreat';

function isDevastated(session: Pick<SimContext, 'state'>, provinceId: number | null): boolean {
  return provinceId !== null
    && (session.state.provinceDevastation?.[provinceId] ?? 0) > session.state.clock.gameTimeHours;
}

export interface CombatRateModifiers {
  readonly frontageUsed: number;
  readonly frontageLimit: number;
  readonly coordination: number;
  readonly stanceOutput: number;
  readonly supply: number;
  /** Defensive-stance and supply multiplier on damage received. */
  readonly protection: number;
  readonly terrain: number;
  readonly devastation: number;
}

export interface FrontDamageRates {
  readonly sideAToB: ReadonlyArray<{ ref: GroupRef; amount: number }>;
  readonly sideBToA: ReadonlyArray<{ ref: GroupRef; amount: number }>;
  readonly sideAOutgoingPerGameHour: number;
  readonly sideBOutgoingPerGameHour: number;
  readonly sideAModifiers: CombatRateModifiers;
  readonly sideBModifiers: CombatRateModifiers;
}

function weightedAverage(armies: readonly ArmyStack[], value: (army: ArmyStack) => number): number {
  let total = 0;
  let weight = 0;
  for (const army of armies) {
    const units = stackUnitCount(army);
    total += value(army) * units;
    weight += units;
  }
  return weight > 0 ? total / weight : 1;
}

function rateModifiers(
  session: Pick<SimContext, 'state' | 'world'>,
  front: BattleFrontState,
  armies: readonly ArmyStack[],
  role: BattleRole,
): CombatRateModifiers {
  const frontageUsed = Math.min(COMBAT_FRONTAGE, armies.reduce((sum, army) => sum + stackUnitCount(army), 0));
  const supply = supplyEffectiveness;
  return {
    frontageUsed,
    frontageLimit: COMBAT_FRONTAGE,
    coordination: 1 / Math.sqrt(Math.max(1, frontageUsed)),
    stanceOutput: weightedAverage(armies, (army) => stanceModifiers(army.stance).attackOutput),
    supply: weightedAverage(armies, supply),
    protection: weightedAverage(armies, (army) => stanceModifiers(army.stance).damageTaken / supply(army)),
    terrain: role === 'defense' ? terrainDefenseMultiplier(session.world, front.x, front.z) : 1,
    devastation: role === 'defense' && isDevastated(session, front.provinceId)
      ? DEVASTATED_DEFENDER_STRENGTH_MULTIPLIER : 1,
  };
}

function scaledDamage(
  damage: Array<{ ref: GroupRef; amount: number }>, multiplier: number,
): Array<{ ref: GroupRef; amount: number }> {
  return multiplier === 1 ? damage : damage.map(({ ref, amount }) => ({ ref, amount: amount * multiplier }));
}

/** The exact pre-damage front calculation shared by simulation and player projection. */
export function calculateFrontDamageRates(
  session: Pick<SimContext, 'state' | 'world'>,
  front: BattleFrontState,
  dtHours = 1,
): FrontDamageRates {
  const a = sideArmies(session, front.sideA);
  const b = sideArmies(session, front.sideB);
  const devastationMultiplier = isDevastated(session, front.provinceId)
    ? DEVASTATED_DEFENDER_STRENGTH_MULTIPLIER : 1;
  const terrainMultiplier = terrainDefenseMultiplier(session.world, front.x, front.z);
  const sideAToB = scaledDamage(
    calculateDamage(a, front.sideA.role, b, dtHours),
    (front.sideA.role === 'defense' ? devastationMultiplier : 1)
      * (front.sideB.role === 'defense' ? terrainMultiplier : 1),
  );
  const sideBToA = scaledDamage(
    calculateDamage(b, front.sideB.role, a, dtHours),
    (front.sideB.role === 'defense' ? devastationMultiplier : 1)
      * (front.sideA.role === 'defense' ? terrainMultiplier : 1),
  );
  const total = (entries: ReadonlyArray<{ amount: number }>): number => entries.reduce(
    (sum, entry) => sum + entry.amount, 0,
  );
  const perGameHour = dtHours > 0 ? 1 / dtHours : 0;
  return {
    sideAToB,
    sideBToA,
    sideAOutgoingPerGameHour: total(sideAToB) * perGameHour,
    sideBOutgoingPerGameHour: total(sideBToA) * perGameHour,
    sideAModifiers: rateModifiers(session, front, a, front.sideA.role),
    sideBModifiers: rateModifiers(session, front, b, front.sideB.role),
  };
}

/** Detach a stack from every combat front and remove it from authoritative state. */
export function destroyArmy(session: SimContext, armyId: string): void {
  removeArmyFromAllFronts(session, armyId);
  delete session.state.armies[armyId];
}

/** One fixed authoritative combat pass. All fronts use one pre-damage snapshot. */
export function stepCombat(session: SimContext, dtHours: number): CombatEvent[] {
  initializeState(session);
  const events: CombatEvent[] = [];
  detectEngagements(session, events);
  const pending = new Map<string, PendingDamage>();
  const activeFronts = Object.values(session.state.battleFronts);
  for (const front of activeFronts) {
    const damage = calculateFrontDamageRates(session, front, dtHours);
    // Terrain protects whichever side is defending at this front by cutting
    // the damage that lands on it — the mirror image of devastation, which
    // instead cuts a devastated defender's own output.
    addDamage(pending, damage.sideAToB);
    addDamage(pending, damage.sideBToA);
  }
  applyPendingDamage(pending);
  if (session.state.simulationTick % 10 === 0) {
    for (const front of activeFronts) {
      events.push({
        kind: 'combatPulse', attacker: front.sideA.countryId, defender: front.sideB.countryId,
        battleId: front.battleId, frontId: front.id, x: front.x, z: front.z,
      });
    }
  }
  for (const army of Object.values(session.state.armies)) {
    if (stackUnitCount(army) > 0) continue;
    const front = army.battleFrontIds?.map((id) => session.state.battleFronts[id]).find(Boolean);
    const attacker = front
      ? (front.sideA.countryId === army.ownerCountryId ? front.sideB.countryId : front.sideA.countryId)
      : 0;
    events.push({
      kind: 'destroyed', attacker, defender: army.ownerCountryId, armyId: army.id,
      x: army.x, z: army.z, battleId: front?.battleId, frontId: front?.id,
    });
    destroyArmy(session, army.id);
  }
  for (const front of activeFronts) {
    if (!session.state.battleFronts[front.id]) continue;
    if (autoRetreat(session, front, front.sideA)) {
      events.push({
        kind: 'retreat', attacker: front.sideB.countryId, defender: front.sideA.countryId,
        x: front.x, z: front.z, battleId: front.battleId, frontId: front.id,
      });
    }
    if (session.state.battleFronts[front.id] && autoRetreat(session, front, front.sideB)) {
      events.push({
        kind: 'retreat', attacker: front.sideA.countryId, defender: front.sideB.countryId,
        x: front.x, z: front.z, battleId: front.battleId, frontId: front.id,
      });
    }
  }
  stepArtillery(session, dtHours, events);
  cleanupFronts(session, events);
  return events;
}
