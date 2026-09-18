/** Country technology progression: two paid, time-based research slots. */
import type { CommandResult } from './commands/types';
import type { CountryState, ResearchState, Stockpile, TechnologyBranch, TechnologyLevels } from './game-state';
import type { BuildingId, ResourceBuildingId } from './units/unit-types';

export const TECHNOLOGY_BRANCHES = ['infantry', 'resources', 'resourceBuildings', 'training', 'hybrid', 'armored', 'navy'] as const;
export const TECHNOLOGY_MAX_LEVEL = 8;
export const RESEARCH_SLOT_COUNT = 2;

export const TECHNOLOGY_LABELS: Record<TechnologyBranch, string> = {
  infantry: 'Infantry Doctrine',
  resources: 'Resource Engineering',
  resourceBuildings: 'Resource Infrastructure',
  training: 'Training & Industry',
  hybrid: 'Mobile Support',
  armored: 'Armored Warfare',
  navy: 'Naval Logistics',
};

/** Time for the project that unlocks each target level. Level I is universal. */
export const TECHNOLOGY_HOURS_BY_LEVEL = [0, 0, 6, 10, 16, 24, 32, 40, 48] as const;

const BASE_RESEARCH_COST_BY_LEVEL: ReadonlyArray<Partial<Stockpile>> = [
  {}, {},
  { funds: 250, food: 60 },
  { funds: 450, food: 100, metal: 40 },
  { funds: 750, food: 160, metal: 80 },
  { funds: 1_150, food: 240, metal: 130, oil: 35 },
  { funds: 1_700, food: 340, metal: 200, oil: 70 },
  { funds: 2_450, food: 480, metal: 300, oil: 120 },
  { funds: 3_500, food: 650, metal: 440, oil: 190 },
];

const BRANCH_COST_MULTIPLIER: Record<TechnologyBranch, number> = {
  infantry: 1, resources: .9, resourceBuildings: 1.05,
  training: 1.1, hybrid: 1.2, armored: 1.35,
  navy: 1.25,
};

export function technologyCost(branch: TechnologyBranch, targetLevel: number): Partial<Stockpile> {
  const base = BASE_RESEARCH_COST_BY_LEVEL[targetLevel] ?? {};
  const multiplier = BRANCH_COST_MULTIPLIER[branch];
  return Object.fromEntries(Object.entries(base).map(([resource, amount]) => [
    resource, Math.ceil((amount ?? 0) * multiplier / 5) * 5,
  ])) as Partial<Stockpile>;
}

export function initialTechnologyLevels(): TechnologyLevels {
  return { infantry: 1, resources: 1, resourceBuildings: 1, training: 1, hybrid: 1, armored: 1, navy: 1 };
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
    ? 'resourceBuildings' : 'training';
}

export function researchPrerequisiteReason(
  levels: TechnologyLevels, branch: TechnologyBranch, targetLevel: number,
): string | undefined {
  if (branch === 'resources' && targetLevel >= 3 && levels.resourceBuildings < targetLevel - 1) {
    return `Requires Resource Infrastructure Level ${targetLevel - 1}.`;
  }
  return undefined;
}

function ensureResearchSlots(country: CountryState): Array<ResearchState | null> {
  const slots = country.researchSlots ?? [];
  if (country.research && !slots.some(Boolean)) slots[0] = country.research;
  country.research = undefined;
  while (slots.length < RESEARCH_SLOT_COUNT) slots.push(null);
  if (slots.length > RESEARCH_SLOT_COUNT) slots.length = RESEARCH_SLOT_COUNT;
  country.researchSlots = slots;
  return slots;
}

function canAfford(stockpile: Stockpile, cost: Partial<Stockpile>): boolean {
  return Object.entries(cost).every(([resource, amount]) =>
    stockpile[resource as keyof Stockpile] >= (amount ?? 0));
}

export function startResearch(country: CountryState | undefined, branch: TechnologyBranch): CommandResult {
  if (!country) return { ok: false, reason: 'Unknown country.' };
  const levels = country.technologies ??= initialTechnologyLevels();
  const slots = ensureResearchSlots(country);
  if (slots.some((research) => research?.branch === branch)) {
    return { ok: false, reason: `${TECHNOLOGY_LABELS[branch]} is already developing.` };
  }
  const freeSlot = slots.findIndex((research) => research === null);
  if (freeSlot < 0) return { ok: false, reason: 'Both research slots are occupied.' };
  const targetLevel = levels[branch] + 1;
  if (targetLevel > TECHNOLOGY_MAX_LEVEL) return { ok: false, reason: 'Maximum technology level reached.' };
  const prerequisite = researchPrerequisiteReason(levels, branch, targetLevel);
  if (prerequisite) return { ok: false, reason: prerequisite };
  const cost = technologyCost(branch, targetLevel);
  if (!canAfford(country.stockpile, cost)) return { ok: false, reason: 'Insufficient resources for this research.' };
  for (const [resource, amount] of Object.entries(cost)) {
    country.stockpile[resource as keyof Stockpile] -= amount ?? 0;
  }
  slots[freeSlot] = {
    branch, targetLevel, progressHours: 0, totalHours: TECHNOLOGY_HOURS_BY_LEVEL[targetLevel],
  };
  return { ok: true };
}

/** Advances research and gives AI countries a deterministic next project. */
export function stepTechnology(countries: Record<number, CountryState>, dtHours: number): void {
  for (const country of Object.values(countries)) {
    country.technologies ??= initialTechnologyLevels();
    const slots = ensureResearchSlots(country);
    if (country.controller === 'ai' && slots.some((research) => research === null)) {
      const available = TECHNOLOGY_BRANCHES.filter((branch) =>
        country.technologies![branch] < TECHNOLOGY_MAX_LEVEL
        && !slots.some((research) => research?.branch === branch)
        && !researchPrerequisiteReason(country.technologies!, branch, country.technologies![branch] + 1));
      if (available.length) {
        startResearch(country, available[(country.id + (country.phase ?? 1) + country.technologies.infantry) % available.length]);
      }
    }
    for (let index = 0; index < slots.length; index += 1) {
      const research = slots[index];
      if (!research) continue;
      research.progressHours = Math.min(research.totalHours, research.progressHours + dtHours);
      if (research.progressHours + 1e-9 < research.totalHours) continue;
      country.technologies[research.branch] = research.targetLevel;
      slots[index] = null;
    }
  }
}
