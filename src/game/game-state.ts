/**
 * Authoritative game state.
 *
 * This is PLAIN DATA: no class instances, no DOM nodes, no GPU handles, no
 * functions. Everything here round-trips through JSON. `GameSession` owns a
 * single `GameState` and is the only writer; the renderer and HUD read a
 * projection of it and cache a GPU/DOM representation — they never own it.
 *
 * Keys that map ids -> records use `Record<number, T>` (JSON object) rather
 * than `Map` so `JSON.stringify` works directly.
 */

import type { ArmyStack } from './units/army';

export const GAME_STATE_VERSION = 2;

export type ResourceKey = 'funds' | 'manpower' | 'food' | 'stone' | 'metal' | 'oil';

export const RESOURCE_KEYS: readonly ResourceKey[] = [
  'funds', 'manpower', 'food', 'stone', 'metal', 'oil',
];

export type Stockpile = Record<ResourceKey, number>;

/**
 * Who drives a country. The player/AI/neutral split is authoritative here so
 * nothing hardcodes "player vs everyone else" — AI countries issue the SAME
 * GameSession commands the player does.
 */
export type ControllerType = 'player' | 'ai' | 'neutral';

export interface CountryState {
  readonly id: number;
  readonly name: string;
  readonly color: string;
  controller: ControllerType;
  stockpile: Stockpile;
  /** Passive per-game-hour income, recomputed by the economy system. */
  income: Stockpile;
  /** Abstract build-throughput stat, not a stockpile. */
  industryCapacity: number;
}

export interface ProvinceBuildings {
  barracks: number;
  tankPlant: number;
  ordnance: number;
}

/** One queued building. Same capture rule as a `ProductionOrder`: it belongs to
 *  the country that paid, and is voided if that country loses the province. */
export interface ConstructionOrder {
  readonly id: string;
  readonly buildingId: keyof ProvinceBuildings;
  readonly ownerCountryId: number;
  progressHours: number;
  readonly totalHours: number;
}

export interface ProductionOrder {
  readonly id: string;
  readonly unitTypeId: string;
  /**
   * Country that paid for this order. The completed unit is delivered to this
   * country, not to whoever owns the province at completion time — so capturing
   * a factory mid-build does not hand you the previous owner's unit.
   */
  readonly ownerCountryId: number;
  /** Game-hours of work already applied. */
  progressHours: number;
  /** Total game-hours required (from the unit type, at this building level). */
  readonly totalHours: number;
}

export type ResourceNodeStatus = 'idle' | 'secured' | 'extracting' | 'exhausted';

/** How a deposit came to exist. */
export type ResourceProvenance = 'generatedNatural' | 'scenarioGuarantee';

export interface ResourceNodeState {
  readonly id: number;
  readonly kind: 'stone' | 'metal' | 'oil';
  readonly x: number;
  readonly z: number;
  remaining: number;
  readonly initialAmount: number;
  /**
   * Country that currently controls the node. Initial value is the owner of
   * the province the node physically sits in — point-in-province from the
   * id raster, never nearest-centroid (resource blocker fix part A).
   * 0 = uncontrolled (node in water/void — should not happen after bootstrap).
   */
  controllerCountryId: number;
  /** Raw id of the province the node sits in, or -1 for water/void. */
  readonly provinceId: number;
  /** Nearest reachable land movement-graph node; -1 when unreachable. */
  readonly accessNodeId: number;
  /** Army currently extracting here, or null. */
  extractorArmyId: string | null;
  status: ResourceNodeStatus;
  readonly provenance: ResourceProvenance;
}

export type Relation = 'peace' | 'war';

export type BattleRole = 'attack' | 'defense';

export interface BattleFrontSideState {
  readonly countryId: number;
  readonly directionNodeId: number;
  role: BattleRole;
  armyIds: string[];
  /** Full HP brought into this front, retained after casualties. */
  entryMaxHpByArmy: Record<string, number>;
}

export interface BattleFrontState {
  readonly id: string;
  readonly battleId: string;
  readonly anchorNodeId: number;
  readonly kind: 'road' | 'province';
  readonly provinceId: number | null;
  readonly x: number;
  readonly z: number;
  sideA: BattleFrontSideState;
  sideB: BattleFrontSideState;
}

export interface BattleState {
  readonly id: string;
  frontIds: string[];
}

export interface GameClock {
  /** Monotonic game-time in hours since scenario start. Drives every system. */
  gameTimeHours: number;
  readonly startDate: string;
}

export interface GameState {
  readonly version: number;
  readonly seed: number;
  readonly scenarioId: string;
  readonly mode: 'campaign' | 'sandbox';
  readonly fogOfWar: boolean;
  readonly economyEnabled: boolean;

  clock: GameClock;
  /** Fixed authoritative 10 Hz step number, used for sequencing and presentation effects. */
  simulationTick: number;

  /** Every country with territory, keyed by id. */
  countries: Record<number, CountryState>;
  /** Dense: province id -> owning country id (authority). */
  provinceOwners: Record<number, number>;
  /** Sparse: only provinces that have at least one building. */
  provinceBuildings: Record<number, ProvinceBuildings>;
  /** Sparse: province id -> ordered production queue. */
  productionQueues: Record<number, ProductionOrder[]>;
  /** Sparse: province id -> ordered building-construction queue. */
  constructionQueues: Record<number, ConstructionOrder[]>;
  /** Sparse: province id -> world-space point newly produced units march to. */
  rallyPoints: Record<number, { x: number; z: number }>;

  armies: Record<string, ArmyStack>;
  battles: Record<string, BattleState>;
  battleFronts: Record<string, BattleFrontState>;
  resourceNodes: Record<number, ResourceNodeState>;

  /** Directed-pair relation key "a:b" with a < b -> 'war' (absent = peace). */
  relations: Record<string, Relation>;

  nextArmyId: number;
  nextBattleId: number;
  nextOrderId: number;
  nextEventId: number;
}

export function emptyStockpile(): Stockpile {
  return { funds: 0, manpower: 0, food: 0, stone: 0, metal: 0, oil: 0 };
}

export function relationKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function relationOf(state: GameState, a: number, b: number): Relation {
  if (a === b) return 'peace';
  return state.relations[relationKey(a, b)] ?? 'peace';
}

export function setRelation(state: GameState, a: number, b: number, relation: Relation): void {
  if (a === b) return;
  const key = relationKey(a, b);
  if (relation === 'peace') delete state.relations[key];
  else state.relations[key] = relation;
}

/**
 * Serialize to a plain JSON string. Because `GameState` is already plain data
 * this is a thin wrapper, but keeping it explicit documents the contract
 * and gives one place to add a schema/version migration later.
 */
export function serializeGameState(state: GameState): string {
  return JSON.stringify(state);
}

export function deserializeGameState(json: string): GameState {
  const parsed = JSON.parse(json) as GameState;
  if (parsed.version !== GAME_STATE_VERSION) {
    throw new Error(
      `Unsupported game-state version ${parsed.version}; expected ${GAME_STATE_VERSION}.`,
    );
  }
  return parsed;
}

/** Structural deep clone via the JSON round-trip — proves serializability too. */
export function cloneGameState(state: GameState): GameState {
  return deserializeGameState(serializeGameState(state));
}
