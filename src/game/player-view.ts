/**
 * Player-facing projection of the authoritative state (fog of war / multiplayer
 * anti-cheat).
 *
 *   FullGameState ──projectFor(viewerCountryId)──▶ information the viewer may know
 *
 * Today this is consumed locally by `main.ts` so the HUD never reads a secret
 * field straight off `GameState`. The same projection is what a future server
 * would run before sending a per-player delta, so it lives in the browser-free
 * game layer and takes only plain state + world facts.
 *
 * Rules:
 *   own army         → full composition, orders, speed.
 *   VISIBLE foreign  → full *currently visible* composition, no orders.
 *   CONTACT foreign  → position + owner only; composition withheld.
 *   HIDDEN foreign   → not projected at all (returns null / absent).
 *   resource node    → own-controlled always; foreign only inside friendly
 *                      vision; everything when fog is off.
 */

import type { ContactLevel } from './visibility';
import {
  computeArmyVisibility, friendlyVisionSources, ownsGroundAt, pointContactLevel,
} from './visibility';
import type { GameState, ResourceNodeState } from './game-state';
import type { WorldData } from './world-data';
import type { ArmyStack, ArmyStatus } from './units/army';
import {
  stackBaseSpeed, stackHealthFraction, stackHp, stackUnitCount,
} from './units/army';
import { unitType } from './units/unit-catalog';

export interface ProjectedGroup {
  readonly typeId: string;
  readonly count: number;
  /** 0..1 average condition of the surviving units in this group. */
  readonly health: number;
}

export interface PlayerArmyView {
  readonly id: string;
  /** The stack's own name when own/visible; a generic label at contact range. */
  readonly name: string;
  readonly ownerCountryId: number;
  readonly ownerName: string;
  readonly ownerColor: string;
  readonly x: number;
  readonly z: number;
  readonly own: boolean;
  /** 'visible' or 'contact' — never 'hidden' (those don't project). */
  readonly contact: Exclude<ContactLevel, 'hidden'>;
  /** Real status for own/visible armies; 'unknown' at contact range. */
  readonly status: ArmyStatus | 'unknown';
  /** Composition, only when own or fully visible; null at contact range. */
  readonly composition: {
    readonly unitCount: number;
    readonly health: number;
    readonly speed: number;
    readonly groups: readonly ProjectedGroup[];
  } | null;
  /** Destination of the active move order — own armies only. */
  readonly moveOrder: { readonly x: number; readonly z: number } | null;
  /** Authoritative road-graph route for an own army's active order, world-space
   *  points from the army's position to the destination. Server projection fills
   *  it (it owns the graph); [] here. */
  readonly moveRoute?: ReadonlyArray<{ readonly x: number; readonly z: number }>;
  readonly moveIntent?: 'move' | 'attack';
  readonly suspendedOrder?: { readonly x: number; readonly z: number; readonly intent: 'move' | 'attack' } | null;
  readonly battleFronts?: ReadonlyArray<{
    id: string;
    directionNodeId: number;
    role: 'attack' | 'defense';
    friendlyHp: number;
    friendlyBaselineHp: number;
    enemyHp: number;
    enemyBaselineHp: number;
    friendlyNextVolleyTick: number;
    enemyNextVolleyTick: number;
    reinforcementCount: number;
  }>;
  readonly legalRetreatExits?: ReadonlyArray<{
    firstNodeId: number; destinationProvinceId: number; x: number; z: number;
    readonly bearing?: string;
  }>;
  readonly artillery?: {
    range: number;
    targetArmyId: string | null;
    manualTarget: boolean;
    nextVolleyTick: number;
  } | null;
}

function groupHealthFraction(typeId: string, count: number, hp: number): number {
  if (count <= 0) return 0;
  return Math.min(1, hp / (count * unitType(typeId).maxHp));
}

function composition(army: ArmyStack): PlayerArmyView['composition'] {
  return {
    unitCount: stackUnitCount(army),
    health: stackHealthFraction(army),
    speed: Math.round(stackBaseSpeed(army)),
    groups: army.units.map((g) => ({
      typeId: g.typeId,
      count: g.count,
      health: groupHealthFraction(g.typeId, g.count, g.hp),
    })),
  };
}

/**
 * Project one army for the player, or `null` when the player may not know it
 * exists (hidden foreign army). `visibility` may be passed in when the caller
 * already computed the map this tick (avoids recomputing per selection).
 */
export function projectArmyView(
  state: GameState,
  world: WorldData,
  viewerCountryId: number,
  armyId: string,
  visibility?: Map<string, ContactLevel>,
): PlayerArmyView | null {
  const army = state.armies[armyId];
  if (!army) return null;

  const own = army.ownerCountryId === viewerCountryId;
  const level = own
    ? 'visible'
    : (visibility ?? computeArmyVisibility(state, world, viewerCountryId)).get(armyId) ?? 'hidden';
  if (level === 'hidden') return null;

  const owner = state.countries[army.ownerCountryId];
  const fullyVisible = own || level === 'visible';
  // A fully identified foreign army exposes the same battle-level readout as
  // an owned army. Contact-only stacks still reveal no combat composition.
  const fronts = fullyVisible ? (army.battleFrontIds ?? []).flatMap((frontId) => {
    const front = state.battleFronts?.[frontId];
    if (!front) return [];
    const friendly = front.sideA.countryId === army.ownerCountryId ? front.sideA : front.sideB;
    const enemy = friendly === front.sideA ? front.sideB : front.sideA;
    const hp = (ids: readonly string[]): number => ids.reduce(
      (sum, id) => sum + (state.armies[id] ? stackHp(state.armies[id]) : 0), 0,
    );
    const baseline = (values: Record<string, number>): number => Object.values(values)
      .reduce((sum, value) => sum + value, 0);
    return [{
      id: front.id,
      directionNodeId: friendly.directionNodeId,
      role: friendly.role,
      friendlyHp: hp(friendly.armyIds),
      friendlyBaselineHp: baseline(friendly.entryMaxHpByArmy),
      enemyHp: hp(enemy.armyIds),
      enemyBaselineHp: baseline(enemy.entryMaxHpByArmy),
      friendlyNextVolleyTick: friendly.nextVolleyTick,
      enemyNextVolleyTick: enemy.nextVolleyTick,
      reinforcementCount: Math.max(0, friendly.armyIds.length - 1),
    }];
  }) : undefined;
  const artilleryGroups = fullyVisible
    ? army.units.filter((group) => unitType(group.typeId).category === 'artillery') : [];
  const artilleryRange = artilleryGroups.length
    ? Math.max(...artilleryGroups.map((group) => unitType(group.typeId).engagementRange)) : 0;
  return {
    id: army.id,
    name: fullyVisible ? army.name : 'Unidentified force',
    ownerCountryId: army.ownerCountryId,
    ownerName: owner?.name ?? `Country ${army.ownerCountryId}`,
    ownerColor: owner?.color ?? '#888888',
    x: army.x,
    z: army.z,
    own,
    contact: level,
    status: fullyVisible ? army.status : 'unknown',
    composition: fullyVisible ? composition(army) : null,
    moveOrder: own && army.order ? { x: army.order.destX, z: army.order.destZ } : null,
    moveRoute: [],
    moveIntent: own && army.order ? army.order.intent : undefined,
    suspendedOrder: own && army.suspendedOrder
      ? { x: army.suspendedOrder.destX, z: army.suspendedOrder.destZ, intent: army.suspendedOrder.intent }
      : null,
    battleFronts: fronts,
    // The server projection, which also owns the movement graph, fills these.
    legalRetreatExits: [],
    artillery: artilleryRange > 0 ? {
      range: artilleryRange,
      targetArmyId: own ? army.artillery?.targetArmyId ?? null : null,
      manualTarget: own ? army.artillery?.manualTarget ?? false : false,
      nextVolleyTick: own ? army.artillery?.nextVolleyTick ?? 0 : 0,
    } : null,
  };
}

/**
 * Resource nodes whose marker the player is allowed to see: own-controlled
 * always, foreign only while inside friendly vision, all of them when fog is
 * off (sandbox). The renderer's dynamic deposit layer is fed from this, so
 * foreign deposits are not globally revealed by the overlay.
 */
export function visibleResourceNodes(
  state: GameState, world: WorldData, viewerCountryId: number,
): ResourceNodeState[] {
  const nodes = Object.values(state.resourceNodes);
  if (!state.fogOfWar) return nodes;
  const sources = friendlyVisionSources(state, world, viewerCountryId);
  return nodes.filter((node) => {
    if (node.controllerCountryId === viewerCountryId) return true;
    if (ownsGroundAt(state, world, viewerCountryId, node.x, node.z)) return true;
    return pointContactLevel(sources, node.x, node.z, world.width) !== 'hidden';
  });
}
