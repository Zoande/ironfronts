/**
 * Data-driven unit-type definitions.
 *
 * The first roster is deliberately small (6 types) but real. Every number here
 * is tuning data, not a hard rule — values are chosen against the world scale
 * (13562 x 7000 world units; provinces are ~150-400 units apart) and will be
 * balanced further in later phases.
 *
 * No behaviour lives here: movement, combat, extraction and production all read
 * these fields. Research gating is represented by `requiredBuilding` only
 * for now; a `techTag` field can be added later without touching consumers.
 */

export type UnitCategory = 'infantry' | 'engineer' | 'recon' | 'armor' | 'artillery';

/** Coarse armour bucket used by the combat table. */
export type ArmorClass = 'soft' | 'light' | 'heavy';

/** HP damage dealt per game-hour to each armour pool by one full-health unit. */
export interface DamageProfile {
  readonly soft: number;
  readonly light: number;
  readonly heavy: number;
}

/** Production buildings. */
export type BuildingId = 'barracks' | 'tankPlant' | 'ordnance';

export interface ResourceCost {
  readonly funds?: number;
  readonly manpower?: number;
  readonly metal?: number;
  readonly oil?: number;
  readonly food?: number;
  readonly stone?: number;
}

export interface UnitType {
  readonly id: string;
  readonly name: string;
  readonly category: UnitCategory;
  readonly armorClass: ArmorClass;
  /** Icon atlas key (resolved to art in the UI layer; see docs/ASSET_CREDITS.md). */
  readonly icon: string;
  readonly maxHp: number;
  /** World units per game-hour on open plains with no road bonus. */
  readonly speed: number;
  /** Offensive firepower used while advancing or bombarding. */
  readonly attack: DamageProfile;
  /** Return-fire profile used while holding ground. It is not mitigation. */
  readonly defense: DamageProfile;
  /** Outer vision radius (contact) in world units. */
  readonly visionOuter: number;
  /** Inner vision radius (composition reveal) in world units. */
  readonly visionInner: number;
  /** Resource-node extraction contribution per unit per game-hour. 0 = cannot extract. */
  readonly extractionRate: number;
  /** Engagement radius for ranged support units; melee units use 0 (artillery). */
  readonly engagementRange: number;
  readonly cost: ResourceCost;
  /** Build time in game-hours at a level-1 building (uses accelerated values). */
  readonly buildTimeHours: number;
  readonly requiredBuilding: BuildingId;
  /** Relative signature weight for "strongest unit on the stack" selection. */
  readonly stackPriority: number;
}
