/** Country technology progression: one free, time-based project at a time. */
import type { CommandResult } from './commands/types';
import type { CountryState, GameState, TechnologyBranch, TechnologyLevels } from './game-state';
import type { BuildingId, ResourceBuildingId } from './units/unit-types';
import { UNIT_TYPE_BY_ID } from './units/unit-catalog';

export const TECHNOLOGY_BRANCHES = ['infantry', 'resources', 'training', 'hybrid', 'armored'] as const;
export const TECHNOLOGY_MAX_LEVEL = 8;

export const TECHNOLOGY_LABELS: Record<TechnologyBranch, string> = {
  infantry: 'Infantry Doctrine',
  resources: 'Resource Engineering',
  training: 'Training & Industry',
  hybrid: 'Mobile Support',
  armored: 'Armored Warfare',
};

/** Time for the project that unlocks each target level. Level I is universal. */
export const TECHNOLOGY_HOURS_BY_LEVEL = [0, 0, 6, 10, 16, 24, 32, 40, 48] as const;

export function initialTechnologyLevels(): TechnologyLevels {
  return { infantry: 1, resources: 1, training: 1, hybrid: 1, armored: 1 };
}

/**
 * Migration floor for saves created before Technology existed.
 *
 * Existing content is treated as evidence of prerequisites the country had
 * already satisfied: military/resource building tiers preserve their
 * corresponding technology floor, leveled units preserve their branch level,
 * and a pre-technology Missile Site preserves today's Hybrid VIII prerequisite.
 *
 * This is only used when a save has no technology ledger at all; normal saves
 * are never silently raised on load.
 */
export function inferLegacyTechnologyLevels(state: GameState, countryId: number): TechnologyLevels {
  const levels = initialTechnologyLevels();

  for (const [provinceIdText, buildings] of Object.entries(state.provinceBuildings)) {
    const provinceId = Number(provinceIdText);
    if (state.provinceOwners[provinceId] !== countryId) continue;
    levels.training = Math.max(
      levels.training,
      buildings.barracks,
      buildings.tankPlant,
      buildings.ordnance,
      buildings.missileSite,
    );
    if (buildings.missileSite > 0) levels.hybrid = TECHNOLOGY_MAX_LEVEL;
  }

  for (const [provinceIdText, economy] of Object.entries(state.provinceEconomies ?? {})) {
    const provinceId = Number(provinceIdText);
    if (state.provinceOwners[provinceId] !== countryId) continue;
    levels.resources = Math.max(
      levels.resources,
      economy.resourceBuildings.fields,
      economy.resourceBuildings.quarry,
      economy.resourceBuildings.mine,
      economy.resourceBuildings.oilPump,
    );
  }

  for (const army of Object.values(state.armies)) {
    if (army.ownerCountryId !== countryId) continue;
    for (const group of army.units) {
      const definition = UNIT_TYPE_BY_ID.get(group.typeId);
      if (!definition) continue;
      levels[definition.technology] = Math.max(levels[definition.technology], definition.level);
    }
  }

  return levels;
}

export function technologyLevels(country: CountryState | undefined): TechnologyLevels {
  return country?.technologies ?? initialTechnologyLevels();
}

export function technologyBranchForUnit(baseId: string): TechnologyBranch {
  if (baseId === 'infantry') return 'infantry';
  if (baseId === 'engineer') return 'resources';
  if (baseId === 'light-tank' || baseId === 'medium-tank') return 'armored';
  return 'hybrid';
}

export function technologyBranchForBuilding(buildingId: BuildingId): TechnologyBranch {
  return (['fields', 'quarry', 'mine', 'oilPump'] as ResourceBuildingId[]).includes(buildingId as ResourceBuildingId)
    ? 'resources' : 'training';
}

export function startResearch(country: CountryState | undefined, branch: TechnologyBranch): CommandResult {
  if (!country) return { ok: false, reason: 'Unknown country.' };
  const levels = country.technologies ??= initialTechnologyLevels();
  if (country.research) return { ok: false, reason: `${TECHNOLOGY_LABELS[country.research.branch]} is already developing.` };
  const targetLevel = levels[branch] + 1;
  if (targetLevel > TECHNOLOGY_MAX_LEVEL) return { ok: false, reason: 'Maximum technology level reached.' };
  country.research = {
    branch, targetLevel, progressHours: 0, totalHours: TECHNOLOGY_HOURS_BY_LEVEL[targetLevel],
  };
  return { ok: true };
}

/** Advances research and gives AI countries a deterministic next project. */
export function stepTechnology(countries: Record<number, CountryState>, dtHours: number): void {
  for (const country of Object.values(countries)) {
    country.technologies ??= initialTechnologyLevels();
    if (!country.research && country.controller === 'ai') {
      const available = TECHNOLOGY_BRANCHES.filter((branch) => country.technologies![branch] < TECHNOLOGY_MAX_LEVEL);
      if (available.length) startResearch(country, available[(country.id + (country.phase ?? 1) + country.technologies.infantry) % available.length]);
    }
    const research = country.research;
    if (!research) continue;
    research.progressHours = Math.min(research.totalHours, research.progressHours + dtHours);
    if (research.progressHours + 1e-9 < research.totalHours) continue;
    country.technologies[research.branch] = research.targetLevel;
    country.research = undefined;
  }
}
