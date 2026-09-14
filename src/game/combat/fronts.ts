import { SpatialIndex } from '../spatial-index';
import type { BattleFrontSideState, BattleFrontState, BattleRole } from '../game-state';
import { relationOf } from '../game-state';
import type { SimContext } from '../sim-context';
import type { ArmyStack } from '../units/army';
import { ensureArmyRuntimeState, stackHp, stackMaxHp } from '../units/army';
import { wrappedDistance } from '../geometry';
import { COMBAT_SNAP } from './constants';
import { provinceAtNode } from './location';
import type { CombatEvent } from './events';
import { stanceModifiers } from './stance';

export function initializeState(session: SimContext): void {
  session.state.simulationTick ??= 0;
  session.state.battles ??= {};
  session.state.battleFronts ??= {};
  session.state.nextBattleId ??= 1;
  for (const army of Object.values(session.state.armies)) {
    ensureArmyRuntimeState(army);
  }
}

export function sideArmies(session: Pick<SimContext, 'state'>, side: BattleFrontSideState): ArmyStack[] {
  return side.armyIds
    .map((id) => session.state.armies[id])
    .filter((army): army is ArmyStack => Boolean(army));
}

export function sideHp(session: SimContext, side: BattleFrontSideState): number {
  return sideArmies(session, side).reduce((sum, army) => sum + stackHp(army), 0);
}

export function sideBaseline(side: BattleFrontSideState): number {
  return Object.values(side.entryMaxHpByArmy).reduce((sum, hp) => sum + hp, 0);
}

/** Average organization (0..1 of max) across a side's armies — armies with no
 *  runtime state yet (should not happen post-initializeState) default to full. */
export function sideOrganizationFraction(session: SimContext, side: BattleFrontSideState): number {
  const armies = sideArmies(session, side);
  if (armies.length === 0) return 1;
  return armies.reduce((sum, army) => sum + (army.organization ?? 100), 0) / (armies.length * 100);
}

/** Average stance retreat-threshold multiplier across a side's armies — a
 *  mixed-stance force averages out rather than one holdout dragging the
 *  whole side either way. */
export function sideRetreatThresholdMultiplier(session: SimContext, side: BattleFrontSideState): number {
  const armies = sideArmies(session, side);
  if (armies.length === 0) return 1;
  return armies.reduce((sum, army) => sum + stanceModifiers(army.stance).retreatThreshold, 0) / armies.length;
}

function directionOf(army: ArmyStack): number {
  return army.lastGraphNodeId ?? army.graphNodeId;
}

function roleOf(army: ArmyStack, provinceId: number | null): BattleRole {
  if (provinceId !== null
    && (army.order === null || army.status === 'idle' || army.status === 'extracting')) return 'defense';
  return army.status === 'moving' ? 'attack' : 'defense';
}

function makeSide(
  army: ArmyStack, role: BattleRole, directionNodeId = directionOf(army),
): BattleFrontSideState {
  return {
    countryId: army.ownerCountryId,
    directionNodeId,
    role,
    armyIds: [army.id],
    entryMaxHpByArmy: { [army.id]: stackMaxHp(army) },
  };
}

function joinArmy(army: ArmyStack, frontId: string): void {
  ensureArmyRuntimeState(army);
  if (!army.battleFrontIds!.includes(frontId)) army.battleFrontIds!.push(frontId);
  if (army.status !== 'engaged') {
    army.suspendedOrder = army.order;
    army.order = null;
    army.extractingNodeId = null;
    army.extractionAssignment = null;
    army.status = 'engaged';
  }
}

function matchingFront(
  session: SimContext, a: ArmyStack, b: ArmyStack, anchorNodeId: number,
): BattleFrontState | undefined {
  return Object.values(session.state.battleFronts).find((front) => {
    if (front.anchorNodeId !== anchorNodeId) return false;
    const directionFor = (army: ArmyStack): number => {
      const side = front.sideA.countryId === army.ownerCountryId ? front.sideA : front.sideB;
      return front.kind === 'province' && side.role === 'defense'
        ? front.anchorNodeId : directionOf(army);
    };
    const aDirection = directionFor(a);
    const bDirection = directionFor(b);
    const direct = front.sideA.countryId === a.ownerCountryId
      && front.sideB.countryId === b.ownerCountryId
      && front.sideA.directionNodeId === aDirection
      && front.sideB.directionNodeId === bDirection;
    const reverse = front.sideB.countryId === a.ownerCountryId
      && front.sideA.countryId === b.ownerCountryId
      && front.sideB.directionNodeId === aDirection
      && front.sideA.directionNodeId === bDirection;
    return direct || reverse;
  });
}

function findOrCreateFront(
  session: SimContext, a: ArmyStack, b: ArmyStack, events: CombatEvent[],
): BattleFrontState {
  const anchorNodeId = a.graphNodeId === b.graphNodeId
    ? a.graphNodeId
    : (wrappedDistance(
      a.x, a.z, session.graph.nodeX[a.graphNodeId], session.graph.nodeZ[a.graphNodeId],
      session.world.width,
    ) <= wrappedDistance(
      b.x, b.z, session.graph.nodeX[b.graphNodeId], session.graph.nodeZ[b.graphNodeId],
      session.world.width,
    ) ? a.graphNodeId : b.graphNodeId);
  const existing = matchingFront(session, a, b, anchorNodeId);
  if (existing) {
    for (const army of [a, b]) {
      const side = existing.sideA.countryId === army.ownerCountryId ? existing.sideA : existing.sideB;
      if (!side.armyIds.includes(army.id)) {
        side.armyIds.push(army.id);
        side.entryMaxHpByArmy[army.id] = stackMaxHp(army);
        joinArmy(army, existing.id);
        events.push({
          kind: 'reinforced', attacker: army.ownerCountryId,
          defender: side === existing.sideA ? existing.sideB.countryId : existing.sideA.countryId,
          battleId: existing.battleId, frontId: existing.id, armyId: army.id, x: existing.x, z: existing.z,
        });
      }
    }
    return existing;
  }

  const provinceId = provinceAtNode(session, anchorNodeId);
  const provinceOwner = provinceId === null ? 0 : session.state.provinceOwners[provinceId] ?? 0;
  const aRole = provinceOwner === a.ownerCountryId ? 'defense'
    : provinceOwner === b.ownerCountryId ? 'attack' : roleOf(a, provinceId);
  const bRole = provinceOwner === b.ownerCountryId ? 'defense'
    : provinceOwner === a.ownerCountryId ? 'attack' : roleOf(b, provinceId);
  const bothMoving = aRole === 'attack' && bRole === 'attack';
  const existingBattle = Object.values(session.state.battles).find((battle) =>
    battle.frontIds.some((id) => session.state.battleFronts[id]?.anchorNodeId === anchorNodeId));
  const serial = existingBattle ? Number(existingBattle.id.replace('battle-', '')) : session.state.nextBattleId++;
  const battleId = existingBattle?.id ?? `battle-${serial}`;
  session.state.nextFrontId ??= 1;
  let frontId: string;
  do { frontId = `front-${session.state.nextFrontId++}`; } while (session.state.battleFronts[frontId]);
  const front: BattleFrontState = {
    id: frontId,
    battleId,
    anchorNodeId,
    kind: provinceId === null ? 'road' : 'province',
    provinceId,
    x: ((a.x + (((b.x - a.x + session.world.width * 1.5) % session.world.width) - session.world.width / 2) / 2) + session.world.width) % session.world.width,
    z: (a.z + b.z) / 2,
    sideA: makeSide(
      a, bothMoving ? 'attack' : aRole,
      aRole === 'defense' && provinceId !== null ? anchorNodeId : directionOf(a),
    ),
    sideB: makeSide(
      b, bothMoving ? 'attack' : bRole,
      bRole === 'defense' && provinceId !== null ? anchorNodeId : directionOf(b),
    ),
  };
  if (existingBattle) existingBattle.frontIds.push(frontId);
  else session.state.battles[battleId] = { id: battleId, frontIds: [frontId] };
  session.state.battleFronts[frontId] = front;
  joinArmy(a, frontId);
  joinArmy(b, frontId);
  events.push({
    kind: 'engaged', attacker: a.ownerCountryId, defender: b.ownerCountryId,
    battleId, frontId, x: front.x, z: front.z,
  });
  return front;
}

export function detectEngagements(session: SimContext, events: CombatEvent[]): void {
  const armies = Object.values(session.state.armies);
  const index = new SpatialIndex(armies, session.world.width);
  const order = new Map(armies.map((army,index) => [army.id,index]));
  const navalTransit = (army: ArmyStack): boolean =>
    army.status === 'embarking' || army.status === 'atSea' || army.status === 'disembarking';
  for (let i = 0; i < armies.length; i += 1) {
    const a = armies[i];
    if (a.retreat?.protected || navalTransit(a)) continue;
    for (const b of index.query(a.x,a.z,COMBAT_SNAP)) {
      if (order.get(b.id)! <= i) continue;
      if (b.retreat?.protected || navalTransit(b) || a.ownerCountryId === b.ownerCountryId) continue;
      if (relationOf(session.state, a.ownerCountryId, b.ownerCountryId) !== 'war') continue;
      if (wrappedDistance(a.x, a.z, b.x, b.z, session.world.width) > COMBAT_SNAP) continue;
      findOrCreateFront(session, a, b, events);
    }
  }
}

function removeArmyFromFront(session: SimContext, front: BattleFrontState, armyId: string): void {
  for (const side of [front.sideA, front.sideB]) {
    side.armyIds = side.armyIds.filter((id) => id !== armyId);
    delete side.entryMaxHpByArmy[armyId];
  }
  const army = session.state.armies[armyId];
  if (army) army.battleFrontIds = army.battleFrontIds?.filter((id) => id !== front.id) ?? [];
}

export function removeArmyFromAllFronts(session: SimContext, armyId: string): void {
  for (const front of Object.values(session.state.battleFronts)) removeArmyFromFront(session, front, armyId);
}

function resumeArmyIfFree(session: SimContext, army: ArmyStack): void {
  ensureArmyRuntimeState(army);
  army.battleFrontIds = army.battleFrontIds!.filter((frontId) => {
    const front = session.state.battleFronts[frontId];
    return Boolean(front && (front.sideA.armyIds.includes(army.id) || front.sideB.armyIds.includes(army.id)));
  });
  if (army.battleFrontIds!.length > 0 || army.status === 'retreating') return;
  if (army.suspendedOrder) {
    army.order = army.suspendedOrder;
    army.suspendedOrder = null;
    army.status = 'moving';
  } else if (army.status === 'engaged') {
    army.status = 'idle';
  }
}

export function cleanupFronts(session: SimContext, events: CombatEvent[]): void {
  for (const front of Object.values(session.state.battleFronts)) {
    front.sideA.armyIds = front.sideA.armyIds.filter((id) => Boolean(session.state.armies[id]));
    front.sideB.armyIds = front.sideB.armyIds.filter((id) => Boolean(session.state.armies[id]));
    if (front.sideA.armyIds.length > 0 && front.sideB.armyIds.length > 0) continue;
    for (const armyId of [...front.sideA.armyIds, ...front.sideB.armyIds]) {
      const army = session.state.armies[armyId];
      if (army) {
        army.battleFrontIds = army.battleFrontIds?.filter((id) => id !== front.id) ?? [];
        resumeArmyIfFree(session, army);
      }
    }
    const battle = session.state.battles[front.battleId];
    if (battle) {
      battle.frontIds = battle.frontIds.filter((id) => id !== front.id);
      if (battle.frontIds.length === 0) delete session.state.battles[battle.id];
    }
    const survivorCountryId = front.sideA.armyIds.length > 0 ? front.sideA.countryId
      : front.sideB.armyIds.length > 0 ? front.sideB.countryId : null;
    events.push({
      kind: 'battleEnded', attacker: front.sideA.countryId, defender: front.sideB.countryId,
      battleId: front.battleId, frontId: front.id, x: front.x, z: front.z, survivorCountryId,
    });
    delete session.state.battleFronts[front.id];
  }
  for (const army of Object.values(session.state.armies)) resumeArmyIfFree(session, army);
}

