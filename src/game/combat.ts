/** Persistent directional close combat, artillery bombardment, and capture. */

import type {
  BattleFrontSideState, BattleFrontState, BattleRole,
} from './game-state';
import { relationOf } from './game-state';
import type { SimContext } from './sim-context';
import type { ArmyStack } from './units/army';
import {
  ensureArmyRuntimeState, stackHp, stackMaxHp, stackUnitCount,
} from './units/army';
import { issueRetreatOrder, retreatPaths, type RetreatPath } from './units/movement';
import { unitType } from './units/unit-catalog';
import { computeArmyVisibility } from './visibility';
import { wrappedDistance } from './geometry';
import { COMBAT_SNAP, COMBAT_VOLLEY_TICKS } from './combat/constants';
import {
  addDamage, applyPendingDamage, calculateVolley, type GroupRef, type PendingDamage,
} from './combat/damage';
import { provinceAtNode } from './combat/location';

export { COMBAT_FRONTAGE, COMBAT_VOLLEY_TICKS } from './combat/constants';
export { stepCapture, type CaptureEvent } from './combat/capture';

export interface CombatEvent {
  readonly kind:
    | 'engaged' | 'reinforced' | 'volley' | 'retreat'
    | 'destroyed' | 'bombardment' | 'battleEnded';
  readonly attacker: number;
  readonly defender: number;
  readonly battleId?: string;
  readonly frontId?: string;
  readonly armyId?: string;
  readonly targetArmyId?: string;
}

function initializeState(session: SimContext): void {
  session.state.simulationTick ??= 0;
  session.state.battles ??= {};
  session.state.battleFronts ??= {};
  session.state.nextBattleId ??= 1;
  for (const army of Object.values(session.state.armies)) ensureArmyRuntimeState(army);
}

function sideArmies(session: SimContext, side: BattleFrontSideState): ArmyStack[] {
  return side.armyIds
    .map((id) => session.state.armies[id])
    .filter((army): army is ArmyStack => Boolean(army));
}

function sideHp(session: SimContext, side: BattleFrontSideState): number {
  return sideArmies(session, side).reduce((sum, army) => sum + stackHp(army), 0);
}

function sideBaseline(side: BattleFrontSideState): number {
  return Object.values(side.entryMaxHpByArmy).reduce((sum, hp) => sum + hp, 0);
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
  army: ArmyStack, role: BattleRole, simulationTick: number, directionNodeId = directionOf(army),
): BattleFrontSideState {
  return {
    countryId: army.ownerCountryId,
    directionNodeId,
    role,
    armyIds: [army.id],
    entryMaxHpByArmy: { [army.id]: stackMaxHp(army) },
    nextVolleyTick: simulationTick,
  };
}

function joinArmy(army: ArmyStack, frontId: string): void {
  ensureArmyRuntimeState(army);
  if (!army.battleFrontIds!.includes(frontId)) army.battleFrontIds!.push(frontId);
  if (army.status !== 'engaged') {
    army.suspendedOrder = army.order;
    army.order = null;
    army.extractingNodeId = null;
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
          battleId: existing.battleId, frontId: existing.id, armyId: army.id,
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
  const frontId = `front-${serial}-${(existingBattle?.frontIds.length ?? 0) + 1}`;
  const front: BattleFrontState = {
    id: frontId,
    battleId,
    anchorNodeId,
    kind: provinceId === null ? 'road' : 'province',
    provinceId,
    x: (a.x + b.x) / 2,
    z: (a.z + b.z) / 2,
    sideA: makeSide(
      a, bothMoving ? 'attack' : aRole, session.state.simulationTick,
      aRole === 'defense' && provinceId !== null ? anchorNodeId : directionOf(a),
    ),
    sideB: makeSide(
      b, bothMoving ? 'attack' : bRole, session.state.simulationTick,
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
    battleId, frontId,
  });
  return front;
}

function detectEngagements(session: SimContext, events: CombatEvent[]): void {
  const armies = Object.values(session.state.armies);
  for (let i = 0; i < armies.length; i += 1) {
    const a = armies[i];
    if (a.retreat?.protected) continue;
    for (let j = i + 1; j < armies.length; j += 1) {
      const b = armies[j];
      if (b.retreat?.protected || a.ownerCountryId === b.ownerCountryId) continue;
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

function removeArmyFromAllFronts(session: SimContext, armyId: string): void {
  for (const front of Object.values(session.state.battleFronts)) removeArmyFromFront(session, front, armyId);
}

function legalFirstNodes(session: SimContext, army: ArmyStack, front: BattleFrontState): number[] {
  if (front.kind === 'road') {
    return army.lastGraphNodeId === null || army.lastGraphNodeId === undefined
      ? [] : [army.lastGraphNodeId];
  }
  const hostileApproaches = new Set<number>();
  for (const other of Object.values(session.state.battleFronts)) {
    if (other.battleId !== front.battleId) continue;
    for (const side of [other.sideA, other.sideB]) {
      if (side.countryId !== army.ownerCountryId) hostileApproaches.add(side.directionNodeId);
    }
  }
  return session.graph.adjacency[army.graphNodeId].filter((id) => !hostileApproaches.has(id));
}

export function legalRetreatPaths(session: SimContext, armyId: string): RetreatPath[] {
  const army = session.state.armies[armyId];
  if (!army || army.status !== 'engaged') return [];
  const front = army.battleFrontIds?.map((id) => session.state.battleFronts[id]).find(Boolean);
  if (!front) return [];
  // Retreat selection is directional: commands and map highlights are keyed by
  // firstNodeId. `retreatPaths` can find the same exit once for every reachable
  // friendly province, so retain only its shortest (first, due to sorting)
  // route instead of flooding the projection with duplicate exit choices.
  const uniqueExits = new Map<number, RetreatPath>();
  for (const route of retreatPaths(session, army, legalFirstNodes(session, army, front))) {
    if (!uniqueExits.has(route.firstNodeId)) uniqueExits.set(route.firstNodeId, route);
  }
  return [...uniqueExits.values()];
}

export function issueManualRetreat(
  session: SimContext, armyId: string, targetX: number, targetZ: number,
): { ok: boolean; reason?: string } {
  const army = session.state.armies[armyId];
  if (!army || army.status !== 'engaged') return { ok: false, reason: 'Army is not in close combat.' };
  const front = army.battleFrontIds?.map((id) => session.state.battleFronts[id]).find(Boolean);
  if (!front) return { ok: false, reason: 'Army is not in close combat.' };

  // Retreat targeting behaves like Move: the click is a world destination.
  // First resolve the road edge most closely aimed at the cursor, including
  // hostile edges. If that edge is not a legal escape, do not silently snap the
  // army sideways or through the enemy line.
  const wrappedX = (value: number): number => {
    const half = session.world.width / 2;
    return (((value + half) % session.world.width) + session.world.width) % session.world.width - half;
  };
  const dx = wrappedX(targetX - army.x);
  const dz = targetZ - army.z;
  if (Math.hypot(dx, dz) < 1) return { ok: false, reason: 'Choose a retreat destination away from the battle.' };
  let aimedFirstNode = -1;
  let aimedScore = -Infinity;
  for (const nodeId of session.graph.adjacency[army.graphNodeId]) {
    const edgeX = wrappedX(session.graph.nodeX[nodeId] - army.x);
    const edgeZ = session.graph.nodeZ[nodeId] - army.z;
    const score = (edgeX * dx + edgeZ * dz) / (Math.hypot(edgeX, edgeZ) * Math.hypot(dx, dz) || 1);
    if (score > aimedScore) { aimedScore = score; aimedFirstNode = nodeId; }
  }

  const routes = retreatPaths(session, army, legalFirstNodes(session, army, front))
    .filter((candidate) => candidate.firstNodeId === aimedFirstNode);
  if (!routes.length) return { ok: false, reason: 'Cannot retreat toward the enemy or through non-friendly territory.' };
  const route = routes.sort((a, b) => {
    const provinceA = session.world.provinces.find((province) => province.id === a.destinationProvinceId);
    const provinceB = session.world.provinces.find((province) => province.id === b.destinationProvinceId);
    const distanceA = provinceA ? Math.hypot(provinceA.center[0] - targetX, provinceA.center[1] - targetZ) : Infinity;
    const distanceB = provinceB ? Math.hypot(provinceB.center[0] - targetX, provinceB.center[1] - targetZ) : Infinity;
    return distanceA - distanceB || a.length - b.length;
  })[0];
  removeArmyFromAllFronts(session, armyId);
  issueRetreatOrder(session, army, route);
  return { ok: true };
}

function autoRetreat(session: SimContext, front: BattleFrontState, side: BattleFrontSideState): boolean {
  const armies = sideArmies(session, side);
  if (armies.length === 0 || sideHp(session, side) >= sideBaseline(side) * 0.1) return false;
  const routes = armies.map((army) => retreatPaths(
    session, army, legalFirstNodes(session, army, front),
  )[0]);
  if (routes.some((route) => !route)) return false;
  for (let i = 0; i < armies.length; i += 1) {
    removeArmyFromAllFronts(session, armies[i].id);
    issueRetreatOrder(session, armies[i], routes[i]);
  }
  return true;
}

function resumeArmyIfFree(army: ArmyStack): void {
  ensureArmyRuntimeState(army);
  if (army.battleFrontIds!.length > 0 || army.status === 'retreating') return;
  if (army.suspendedOrder) {
    army.order = army.suspendedOrder;
    army.suspendedOrder = null;
    army.status = 'moving';
  } else if (army.status === 'engaged') {
    army.status = 'idle';
  }
}

function cleanupFronts(session: SimContext, events: CombatEvent[]): void {
  for (const front of Object.values(session.state.battleFronts)) {
    front.sideA.armyIds = front.sideA.armyIds.filter((id) => Boolean(session.state.armies[id]));
    front.sideB.armyIds = front.sideB.armyIds.filter((id) => Boolean(session.state.armies[id]));
    if (front.sideA.armyIds.length > 0 && front.sideB.armyIds.length > 0) continue;
    for (const armyId of [...front.sideA.armyIds, ...front.sideB.armyIds]) {
      const army = session.state.armies[armyId];
      if (army) {
        army.battleFrontIds = army.battleFrontIds?.filter((id) => id !== front.id) ?? [];
        resumeArmyIfFree(army);
      }
    }
    const battle = session.state.battles[front.battleId];
    if (battle) {
      battle.frontIds = battle.frontIds.filter((id) => id !== front.id);
      if (battle.frontIds.length === 0) delete session.state.battles[battle.id];
    }
    events.push({
      kind: 'battleEnded', attacker: front.sideA.countryId, defender: front.sideB.countryId,
      battleId: front.battleId, frontId: front.id,
    });
    delete session.state.battleFronts[front.id];
  }
  for (const army of Object.values(session.state.armies)) resumeArmyIfFree(army);
}

function artilleryDamage(army: ArmyStack, target: ArmyStack): Array<{ ref: GroupRef; amount: number }> {
  const artilleryOnly: ArmyStack = {
    ...army,
    units: army.units.filter((group) => unitType(group.typeId).category === 'artillery'),
  };
  return calculateVolley([artilleryOnly], 'attack', [target]);
}

function stepArtillery(session: SimContext, events: CombatEvent[]): void {
  const armies = Object.values(session.state.armies);
  for (const army of armies) {
    ensureArmyRuntimeState(army);
    if (army.status !== 'idle' && army.status !== 'extracting') continue;
    const artillery = army.units.filter((group) => unitType(group.typeId).category === 'artillery');
    if (artillery.length === 0) continue;
    const range = Math.max(...artillery.map((group) => unitType(group.typeId).engagementRange));
    const visibility = computeArmyVisibility(session.state, session.world, army.ownerCountryId);
    const validTargets = armies.filter((target) => target.id !== army.id
      && relationOf(session.state, army.ownerCountryId, target.ownerCountryId) === 'war'
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
    if (!target || session.state.simulationTick < army.artillery!.nextVolleyTick) continue;
    const pending = new Map<string, PendingDamage>();
    addDamage(pending, artilleryDamage(army, target));
    applyPendingDamage(pending);
    const destroyed = stackUnitCount(target) === 0;
    army.artillery!.nextVolleyTick = destroyed
      ? session.state.simulationTick
      : session.state.simulationTick + COMBAT_VOLLEY_TICKS;
    events.push({
      kind: 'bombardment', attacker: army.ownerCountryId, defender: target.ownerCountryId,
      armyId: army.id, targetArmyId: target.id,
    });
    if (destroyed) {
      removeArmyFromAllFronts(session, target.id);
      delete session.state.armies[target.id];
      events.push({
        kind: 'destroyed', attacker: army.ownerCountryId, defender: target.ownerCountryId,
        armyId: target.id,
      });
    }
  }
}

/** One fixed authoritative combat pass. All due fronts use one pre-damage snapshot. */
export function stepCombat(session: SimContext, _dtHours: number): CombatEvent[] {
  initializeState(session);
  const events: CombatEvent[] = [];
  detectEngagements(session, events);
  const pending = new Map<string, PendingDamage>();
  const due: BattleFrontState[] = [];
  for (const front of Object.values(session.state.battleFronts)) {
    const aDue = session.state.simulationTick >= front.sideA.nextVolleyTick;
    const bDue = session.state.simulationTick >= front.sideB.nextVolleyTick;
    if (!aDue && !bDue) continue;
    const a = sideArmies(session, front.sideA);
    const b = sideArmies(session, front.sideB);
    if (aDue) {
      addDamage(pending, calculateVolley(a, front.sideA.role, b));
      front.sideA.nextVolleyTick = session.state.simulationTick + COMBAT_VOLLEY_TICKS;
    }
    if (bDue) {
      addDamage(pending, calculateVolley(b, front.sideB.role, a));
      front.sideB.nextVolleyTick = session.state.simulationTick + COMBAT_VOLLEY_TICKS;
    }
    due.push(front);
  }
  applyPendingDamage(pending);
  for (const front of due) {
    events.push({
      kind: 'volley', attacker: front.sideA.countryId, defender: front.sideB.countryId,
      battleId: front.battleId, frontId: front.id,
    });
  }
  for (const army of Object.values(session.state.armies)) {
    if (stackUnitCount(army) > 0) continue;
    removeArmyFromAllFronts(session, army.id);
    delete session.state.armies[army.id];
    events.push({ kind: 'destroyed', attacker: 0, defender: army.ownerCountryId, armyId: army.id });
  }
  for (const front of due) {
    if (!session.state.battleFronts[front.id]) continue;
    if (autoRetreat(session, front, front.sideA)) {
      events.push({ kind: 'retreat', attacker: front.sideB.countryId, defender: front.sideA.countryId });
    }
    if (session.state.battleFronts[front.id] && autoRetreat(session, front, front.sideB)) {
      events.push({ kind: 'retreat', attacker: front.sideA.countryId, defender: front.sideB.countryId });
    }
  }
  stepArtillery(session, events);
  cleanupFronts(session, events);
  return events;
}
