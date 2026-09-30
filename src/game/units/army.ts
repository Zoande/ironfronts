/**
 * Authoritative army-stack data model.
 *
 * Plain data (part of `GameState`). Units are tracked as GROUPS
 * (typeId + count + pooled hp), never as individual soldiers. One stack
 * renders as one map marker; the strongest group drives its portrait.
 */

import type { UnitType } from './unit-types';
import type { PhysicalResource } from '../game-state';
import { unitType } from './unit-catalog';
import type { TransportManifestation } from '../naval/transport';

export const SUPPLY_CAPACITY_PER_UNIT = 100;
/** Short labels leave room for the activity readout, flag, and orders in the army header. */
export const AUTO_ARMY_NAME_LENGTH = 16;
export function generatedArmyName(value: string): string {
  const name = value.trim();
  if (name.length <= AUTO_ARMY_NAME_LENGTH) return name;
  const cut = name.slice(0, AUTO_ARMY_NAME_LENGTH + 1).lastIndexOf(' ');
  return name.slice(0, cut >= 8 ? cut : AUTO_ARMY_NAME_LENGTH).trimEnd();
}

/**
 * Combat posture — see combat/stance.ts for what each one actually does.
 * Names match the existing `stance-*` icon set 1:1 so the UI needs no mapping
 * layer. 'attack-defend' (balanced) is the default: no modifiers either way.
 */
export type ArmyStance = 'attack' | 'attack-defend' | 'defend' | 'defend-retreat' | 'retreat';

export type ArmyStatus =
  | 'idle'
  | 'moving'
  | 'extracting'
  | 'engaged'
  | 'retreating'
  /** Boarding transport at the coastal node before a sea/ferry crossing. */
  | 'embarking'
  /** Underway on a sea/ferry edge between two coastal nodes. */
  | 'atSea'
  /** Unloading at the coastal node after a sea/ferry crossing. */
  | 'disembarking';

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
  /** Optional exact stop point on the final road edge, oriented from `from`. */
  readonly roadDestination?: {
    readonly edgeId: number; readonly from: number; readonly to: number;
    readonly distanceAlongEdge: number;
  };
  /** Final open-water position, reached from a connected sea-graph anchor. */
  readonly seaDestination?: { readonly x: number; readonly z: number; readonly anchorNodeId: number };
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
  /** Authoritative road position. x/z are derived caches for world-space systems. */
  edge?: { edgeId?: number; from: number; to: number; distanceAlongEdge?: number } | null;
  units: UnitGroup[];
  status: ArmyStatus;
  order: MoveOrder | null;
  /** Resource node id this stack is extracting, or null. */
  extractingNodeId: number | null;
  /** V4 renewable production assignment. */
  extractionAssignment?: { provinceId: number; resource: PhysicalResource } | null;
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
  /** Present only while status is 'embarking' | 'atSea' | 'disembarking'. */
  navalCrossing?: {
    readonly fromNodeId: number;
    readonly toNodeId: number;
    /** Counts down during 'embarking'/'disembarking'; unused during 'atSea'
     *  (that phase instead consumes the normal movement distance budget). */
    hoursRemaining: number;
    /** A new order from an offshore stop first returns to its graph anchor. */
    returningToAnchor?: boolean;
  } | null;
  /** Temporary sea-domain manifestation. Cargo remains in `units` on its
   * normal land HP scale; ship HP and the snapshotted naval tech live here. */
  transport?: TransportManifestation | null;
  /** Combat posture; see ArmyStance. Defaults to 'attack-defend' (balanced). */
  stance?: ArmyStance;
  /** Whether a supply route exists; low stored supply applies the penalties. */
  inSupply?: boolean;
  /** One field-supply reserve for the whole stack. */
  supply?: number;
  supplyCapacity?: number;
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
  stack.navalCrossing ??= null;
  stack.transport ??= null;
  stack.stance ??= 'attack-defend';
  stack.inSupply ??= true;
  stack.supplyCapacity ??= 0;
  stack.extractionAssignment ??= null;
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
    const type = unitType(group.typeId);
    slowest = Math.min(slowest, type.speed);
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
  const targetCapacity = stackUnitCount(target) * SUPPLY_CAPACITY_PER_UNIT;
  const sourceCapacity = stackUnitCount(source) * SUPPLY_CAPACITY_PER_UNIT;
  const mergedSupply = (target.supply ?? targetCapacity) + (source.supply ?? sourceCapacity);
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
  target.supplyCapacity = targetCapacity + sourceCapacity;
  target.supply = Math.min(target.supplyCapacity, mergedSupply);
  source.supplyCapacity = 0;
  source.supply = 0;
}

export function makeGroup(typeId: string, count: number, hpFraction = 1): UnitGroup {
  return {
    typeId,
    count,
    hp: count * unitType(typeId).maxHp * hpFraction,
    experience: 0,
  };
}
