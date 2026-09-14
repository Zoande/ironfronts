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

import { parseGameState } from './state-schema';
import type { ArmyStack } from './units/army';

export const GAME_STATE_VERSION = 4;

export type ResourceKey = 'funds' | 'manpower' | 'food' | 'stone' | 'metal' | 'oil';

export const RESOURCE_KEYS: readonly ResourceKey[] = [
  'funds', 'manpower', 'food', 'stone', 'metal', 'oil',
];

export type Stockpile = Record<ResourceKey, number>;
export type PhysicalResource = 'food' | 'stone' | 'metal' | 'oil';
export type UpkeepResource = 'funds' | 'food' | 'metal' | 'oil';
export type ResourcePotential = Record<PhysicalResource, number>;
export type ResourceBuildingId = 'fields' | 'quarry' | 'mine' | 'oilPump';
export type ResourceBuildingTiers = Record<ResourceBuildingId, number>;
export type TechnologyBranch = 'infantry' | 'resources' | 'training' | 'hybrid' | 'armored';
export type TechnologyLevels = Record<TechnologyBranch, number>;

export interface ResearchState {
  branch: TechnologyBranch;
  targetLevel: number;
  progressHours: number;
  totalHours: number;
}

export interface ResourceShortageState {
  severity: number;
  /** Highest alert threshold currently armed/issued. */
  notifiedThreshold: 0 | 25 | 50 | 75;
}

export type ShortageLedger = Record<UpkeepResource, ResourceShortageState>;

export interface ProvinceEconomy {
  resourcePotential: ResourcePotential;
  /** Permanent scenario-start baseline; it transfers with the province. */
  baseProduction: Stockpile;
  resourceBuildings: ResourceBuildingTiers;
  productionCapacity: number;
  constructionCapacity: number;
  /** Playable-country fallback sites that may produce below the normal cutoff. */
  normalizedOpeningSites?: PhysicalResource[];
}

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
  upkeep?: Stockpile;
  netIncome?: Stockpile;
  coverage?: Record<UpkeepResource, number>;
  reserveHours?: Record<UpkeepResource, number | null>;
  shortages?: ShortageLedger;
  /** Abstract build-throughput stat, not a stockpile. */
  industryCapacity: number;
  /**
   * Ready strategic warheads. Accrues slowly while the country holds an
   * Ordnance Workshop; one is spent per strategic strike. Optional and
   * defaulted on load so pre-strike v2 saves keep working (no GAME_VERSION
   * bump — the save gate checks version/id, not shape).
   */
  warheads?: number;
  /**
   * Progression tier — 1 (Local Command), 2 (Industrial Mobilization), or 3
   * (Total War). Gates the more advanced buildings (see phase.ts); advances
   * automatically as the country invests in industry or as time passes, never
   * by manual player action, so it can't get permanently stuck. Optional and
   * defaulted on load (see state-schema.ts, computed from buildings already
   * owned so no existing save is retroactively locked out of anything it has
   * already built) — no GAME_VERSION bump.
   */
  phase?: number;
  /** All branches begin at I. Only one no-cost research project may advance. */
  technologies?: TechnologyLevels;
  research?: ResearchState;
}

/** Terminal state of a campaign, from the human player's point of view. */
export interface GameOutcome {
  readonly result: 'victory' | 'defeat';
  readonly reason: string;
  /** Game-hour the campaign was decided. */
  readonly atGameHours: number;
}

export interface ProvinceBuildings {
  barracks: number;
  tankPlant: number;
  ordnance: number;
  /** Rocket-launch site: accrues strategic warheads and defines the reach a
   *  strike can be aimed within. Additive field — pre-missile v2 saves default
   *  it to 0 on load (see GameSession.restore), no GAME_VERSION bump. */
  missileSite: number;
}

/** One queued building. Same capture rule as a `ProductionOrder`: it belongs to
 *  the country that paid, and is voided if that country loses the province. */
export interface ConstructionOrder {
  readonly id: string;
  readonly buildingId: keyof ProvinceBuildings | ResourceBuildingId;
  readonly ownerCountryId: number;
  progressWork?: number;
  readonly totalWork?: number;
  /** Resource upgrades carry their intended level so future tiers may queue. */
  readonly targetTier?: number;
  /** @deprecated v3 fixture compatibility. */
  progressHours?: number;
  /** @deprecated v3 fixture compatibility. */
  readonly totalHours?: number;
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
  progressWork?: number;
  /** Total game-hours required (from the unit type, at this building level). */
  readonly totalWork?: number;
  /** @deprecated v3 fixture compatibility. */
  progressHours?: number;
  /** @deprecated v3 fixture compatibility. */
  readonly totalHours?: number;
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

export type Relation = 'peace' | 'allied' | 'war';

export interface DiplomacyMessage {
  readonly id: string;
  readonly fromCountryId: number;
  readonly toCountryId: number;
  readonly body: string;
  readonly sentAtTick: number;
}

export interface DiplomacyProposal {
  readonly id: string;
  readonly fromCountryId: number;
  readonly toCountryId: number;
  readonly kind: 'alliance' | 'peace';
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn';
  readonly createdAtTick: number;
  resolvedAtTick?: number;
}

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
  /** Scenario epoch retained for campaign metadata, not sunlight progression. */
  initialEpochMs?: number;
  generation?: number;
  pendingHours?: number;
  /** Persisted cadence debt keeps slow systems stable across saves/restarts. */
  cadence?: { incomeHours: number; supplyHours: number; aiHours: number };
  /** Monotonic simulation time in hours since scenario start. Drives gameplay. */
  gameTimeHours: number;
  readonly startDate: string;
  /** Visual world clock anchor. It advances at real 1x even while servers are down. */
  visualEpochMs?: number;
  visualAnchorRealEpochMs?: number;
  visualUtcOffsetMinutes?: number;
  /** IANA timezone used by linked visual time, including daylight-saving changes. */
  visualTimeZone?: string;
  visualTimezoneLinked?: boolean;
  visualGeneration?: number;
}

export interface WorldWeather {
  mode: 'automatic' | 'forced-clear' | 'forced-rain';
  raining: boolean;
  scheduleDay: string;
  rainStartMinute: number;
  rainDurationMinutes: number;
}

export interface GameState {
  readonly version: number;
  readonly seed: number;
  readonly scenarioId: string;
  readonly mode: 'campaign' | 'sandbox';
  readonly fogOfWar: boolean;
  readonly economyEnabled: boolean;

  clock: GameClock;
  /** Persistent real-time weather; automatic rain occurs once per UTC day for 1–2 hours. */
  weather?: WorldWeather;
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
  /** Authoritative v4 province resource/development state. */
  provinceEconomies?: Record<number, ProvinceEconomy>;
  /** @deprecated v3 compatibility only; v4 runtime leaves this empty. */
  resourceNodes: Record<number, ResourceNodeState>;

  /** Undirected-pair relation key "a:b" with a < b (absent = peace). */
  relations: Record<string, Relation>;

  /**
   * Sparse: province id -> game-hour at which strike devastation lifts. While a
   * province is devastated, defending stacks have sharply reduced combat
   * strength but still must be fought. Additive optional field — pre-strike v2
   * saves default it to `{}` on load, no GAME_VERSION bump.
   */
  provinceDevastation?: Record<number, number>;

  /**
   * Set once the campaign is decided, then frozen. Absent = still in progress.
   * Additive optional field — no GAME_VERSION bump.
   */
  outcome?: GameOutcome;

  /** Optional for compatibility with v2 snapshots created before diplomacy. */
  diplomacyMessages?: Record<string, DiplomacyMessage>;
  /** Optional for compatibility with v2 snapshots created before diplomacy. */
  diplomacyProposals?: Record<string, DiplomacyProposal>;
  /** Shared monotonic id source for diplomacy records. */
  nextDiplomacyId?: number;

  nextArmyId: number;
  nextBattleId: number;
  nextFrontId?: number;
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
  if (relation === 'war') {
    // `a` is the aggressor at every authoritative war-declaration call site.
    // An unclaimed defender starts planning immediately instead of remaining
    // inert for the rest of the war.
    const defender = state.countries[b];
    if (defender?.controller === 'neutral') defender.controller = 'ai';
    for (const proposal of Object.values(state.diplomacyProposals ?? {})) {
      if (proposal.status !== 'pending'
        || relationKey(proposal.fromCountryId, proposal.toCountryId) !== key) continue;
      proposal.status = 'withdrawn';
      proposal.resolvedAtTick = state.simulationTick;
    }
  }
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
  return parseGameState(JSON.parse(json));
}

/** Trusted runtime state is already plain data; validation belongs to restore. */
export function cloneGameState(state: GameState): GameState { return structuredClone(state); }
