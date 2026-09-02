/**
 * Authoritative army-stack data model.
 *
 * Plain data (part of `GameState`). Units are tracked as GROUPS
 * (typeId + count + pooled hp), never as individual soldiers. One stack
 * renders as one map marker; the strongest group drives its portrait.
 */

import type { UnitType } from './unit-types';
import { unitType } from './unit-catalog';

export type ArmyStatus =
  | 'idle'
  | 'moving'
  | 'extracting'
  | 'engaged'
  | 'retreating';

export interface UnitGroup {
  readonly typeId: string;
  count: number;
  /** Pooled hit points for the whole group (0 .. count * maxHp). */
  hp: number;
  /** Reserved for later; 0 for now (experience?). */
  experience: number;
}

export interface MoveOrder {
  /** Ordered land movement-graph node ids still to traverse (current target first). */
  readonly path: number[];
  /** World-space destination (the last node's position), for marker/HUD. */
  readonly destX: number;
  readonly destZ: number;
  /** 'move' = cream route, 'attack' = red route. */
  readonly intent: 'move' | 'attack';
  /** Typed strategic target. Unit targets are re-pathed while detected. */
  target?:
    | { readonly kind: 'position'; readonly x: number; readonly z: number }
    | { readonly kind: 'province'; readonly provinceId: number; readonly x?: number; readonly z?: number }
    | { readonly kind: 'army'; readonly armyId: string; lastKnownX: number; lastKnownZ: number };
  /** Progress along the edge to `path[0]`, world units. */
  edgeProgress: number;
}

export interface ArmyStack {
  readonly id: string;
  ownerCountryId: number;
  name: string;
  /** World-space position (world units, X wraps). */
  x: number;
  z: number;
  /** Land movement-graph node the stack is currently at / leaving. */
  graphNodeId: number;
  units: UnitGroup[];
  status: ArmyStatus;
  order: MoveOrder | null;
  /** Resource node id this stack is extracting, or null. */
  extractingNodeId: number | null;
  /** Node occupied before graphNodeId; defines the back edge for retreat. */
  lastGraphNodeId?: number | null;
  /** Order paused by close combat and resumed when every joined front clears. */
  suspendedOrder?: MoveOrder | null;
  /** Close-combat front ids this army currently participates in. */
  battleFrontIds?: string[];
  /** Locked retreat metadata. */
  retreat?: {
    readonly destinationProvinceId: number;
    readonly protectedUntilNodeId: number;
    protected: boolean;
  } | null;
  /** Ranged artillery targeting state. */
  artillery?: {
    targetArmyId: string | null;
    manualTarget: boolean;
  };
}

export function groupMaxHp(group: UnitGroup): number {
  return group.count * unitType(group.typeId).maxHp;
}

export function groupHealthFraction(group: UnitGroup): number {
  const max = groupMaxHp(group);
  return max > 0 ? Math.max(0, Math.min(1, group.hp / max)) : 0;
}

export function ensureArmyRuntimeState(stack: ArmyStack): void {
  stack.lastGraphNodeId ??= null;
  stack.suspendedOrder ??= null;
  stack.battleFrontIds ??= [];
  stack.retreat ??= null;
  stack.artillery ??= { targetArmyId: null, manualTarget: false };
}

export function stackUnitCount(stack: ArmyStack): number {
  let total = 0;
  for (const group of stack.units) total += group.count;
  return total;
}

export function stackHp(stack: ArmyStack): number {
  let total = 0;
  for (const group of stack.units) total += group.hp;
  return total;
}

export function stackMaxHp(stack: ArmyStack): number {
  let total = 0;
  for (const group of stack.units) total += groupMaxHp(group);
  return total;
}

/** 0..1 overall condition. */
export function stackHealthFraction(stack: ArmyStack): number {
  const max = stackMaxHp(stack);
  return max > 0 ? stackHp(stack) / max : 0;
}

/**
 * The representative unit for the map marker: highest `stackPriority`,
 * ties broken by larger group count then unit id for determinism.
 */
export function strongestGroup(stack: ArmyStack): UnitGroup | null {
  let best: UnitGroup | null = null;
  let bestType: UnitType | null = null;
  for (const group of stack.units) {
    if (group.count <= 0) continue;
    const type = unitType(group.typeId);
    if (
      !best || !bestType ||
      type.stackPriority > bestType.stackPriority ||
      (type.stackPriority === bestType.stackPriority && group.count > best.count) ||
      (type.stackPriority === bestType.stackPriority && group.count === best.count &&
        type.id < bestType.id)
    ) {
      best = group;
      bestType = type;
    }
  }
  return best;
}

/** Stack speed is set by its slowest unit. Empty stack -> 0. */
export function stackBaseSpeed(stack: ArmyStack): number {
  let slowest = Infinity;
  for (const group of stack.units) {
    if (group.count <= 0) continue;
    slowest = Math.min(slowest, unitType(group.typeId).speed);
  }
  return Number.isFinite(slowest) ? slowest : 0;
}

/** Total per-game-hour extraction capacity of the stack. */
export function stackExtractionRate(stack: ArmyStack): number {
  let rate = 0;
  for (const group of stack.units) {
    rate += group.count * unitType(group.typeId).extractionRate;
  }
  return rate;
}

export function canExtract(stack: ArmyStack): boolean {
  return stackExtractionRate(stack) > 0;
}

/**
 * Merge `source` groups into `target` in place. Same typeId groups pool
 * their count and hp; new types are appended. `source.units` is emptied.
 */
export function mergeStacks(target: ArmyStack, source: ArmyStack): void {
  for (const incoming of source.units) {
    if (incoming.count <= 0) continue;
    const existing = target.units.find((group) => group.typeId === incoming.typeId);
    if (existing) {
      existing.count += incoming.count;
      existing.hp += incoming.hp;
      existing.experience = Math.max(existing.experience, incoming.experience);
    } else {
      target.units.push({ ...incoming });
    }
  }
  source.units = [];
}

export function makeGroup(typeId: string, count: number, hpFraction = 1): UnitGroup {
  return {
    typeId,
    count,
    hp: count * unitType(typeId).maxHp * hpFraction,
    experience: 0,
  };
}
