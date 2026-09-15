import {
  RESOURCE_TIER_ENGINEER_CAP,
  RESOURCE_TIER_ENGINEER_MULTIPLIER,
  RESOURCE_TIER_PASSIVE,
} from '../game/economy/resources';
import { UNIT_PRODUCTION_RATE_BY_LEVEL } from '../game/production';
import { TECHNOLOGY_HOURS_BY_LEVEL } from '../game/technology';
import { UNIT_TYPE_BY_ID } from '../game/units/unit-catalog';
import type { TechnologyBranch, TechnologyCategory, TechnologyView } from './ui-state';

const technologyPngAssets = import.meta.glob('./assets/technology/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
const technologyJpegAssets = import.meta.glob('./assets/technology/*.jpg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;
const technologyAssets = { ...technologyPngAssets, ...technologyJpegAssets };

const technologyAsset = (name: string): string => {
  const url = technologyAssets[`./assets/technology/${name}.png`]
    ?? technologyAssets[`./assets/technology/${name}.jpg`];
  if (!url) throw new Error(`Missing technology artwork: ${name}`);
  return url;
};

export type TechnologyLevelVisualState = 'completed' | 'current' | 'available' | 'researching' | 'locked';

export interface TechnologyLevelBriefing {
  readonly level: number;
  readonly effect: string;
  readonly hours: number;
  readonly visualUrl: string;
}

export interface TechnologyBranchPresentation {
  readonly id: TechnologyBranch;
  readonly title: string;
  readonly iconUrl: string;
  readonly backdropUrl: string;
  readonly levels: readonly TechnologyLevelBriefing[];
}

export interface TechnologyPanelLevel extends TechnologyLevelBriefing {
  readonly state: TechnologyLevelVisualState;
}

export interface TechnologyPanelModel {
  readonly branch: TechnologyBranchPresentation;
  readonly currentLevel: number;
  readonly levels: readonly TechnologyPanelLevel[];
  readonly inspected: TechnologyPanelLevel;
  readonly canResearch: boolean;
  readonly blockedReason?: string;
  readonly active?: {
    readonly branch: TechnologyBranch;
    readonly percent: number;
    readonly etaSeconds: number;
  };
}

type TechnologyLevelDraft = Pick<TechnologyLevelBriefing, 'level'>;

const eightLevels = (): readonly TechnologyLevelDraft[] =>
  Array.from({ length: 8 }, (_, index) => ({ level: index + 1 }));

type TechnologyBranchDraft = Omit<TechnologyBranchPresentation, 'backdropUrl' | 'levels'> & {
  readonly levels: readonly TechnologyLevelDraft[];
};

const technologyArtworkKey = (branch: TechnologyBranch): string =>
  branch === 'resourceBuildings' ? 'resource-buildings' : branch;

const presentBranch = (branch: TechnologyBranchDraft): TechnologyBranchPresentation => ({
  ...branch,
  backdropUrl: technologyAsset(`backdrop-${technologyArtworkKey(branch.id)}`),
  levels: branch.levels.map((level) => ({
    ...level,
    effect: technologyLevelEffectText(branch.id, level.level),
    hours: TECHNOLOGY_HOURS_BY_LEVEL[level.level],
    visualUrl: technologyAsset(`${technologyArtworkKey(branch.id)}-${level.level}`),
  })),
});

const multiplier = (value: number, baseline = 1): string => {
  const ratio = baseline === 0 ? 1 : value / baseline;
  return `×${Number(ratio.toFixed(2))}`;
};

const unitAtLevel = (baseId: string, level: number) => {
  const id = level === 1 ? baseId : `${baseId}-l${level}`;
  const unit = UNIT_TYPE_BY_ID.get(id);
  if (!unit) throw new Error(`Missing Level ${level} unit data for ${baseId}`);
  return unit;
};

const unitEffect = (baseId: string, level: number): string => {
  const base = unitAtLevel(baseId, 1);
  const unit = unitAtLevel(baseId, level);
  return [
    `HP ${multiplier(unit.maxHp, base.maxHp)}`,
    `ATK ${multiplier(unit.attack.soft, base.attack.soft)}`,
    `SPD ${multiplier(unit.speed, base.speed)}`,
    `COST ${multiplier(unit.buildCost.funds ?? 0, base.buildCost.funds ?? 0)}`,
    `UPKEEP ${multiplier(unit.upkeep.fundsPerHour ?? 0, base.upkeep.fundsPerHour ?? 0)}`,
    `BUILD ${multiplier(unit.buildWork, base.buildWork)}`,
  ].join(' · ');
};

/** Numeric dossier effect copy derived from the simulation's live balance tables. */
export function technologyLevelEffectText(branch: TechnologyBranch, level: number): string {
  const safeLevel = Math.max(1, Math.min(8, Math.round(level)));
  switch (branch) {
    case 'infantry':
      return unitEffect('infantry', safeLevel);
    case 'resources':
      return unitEffect('engineer', safeLevel);
    case 'resourceBuildings':
      return `+${RESOURCE_TIER_PASSIVE[safeLevel]}/h · `
        + `${RESOURCE_TIER_ENGINEER_CAP[safeLevel]} ENG · `
        + `OUTPUT ×${RESOURCE_TIER_ENGINEER_MULTIPLIER[safeLevel]}`;
    case 'training': {
      const rate = UNIT_PRODUCTION_RATE_BY_LEVEL[safeLevel];
      return `${rate}/h · RATE ${multiplier(rate, UNIT_PRODUCTION_RATE_BY_LEVEL[1])}`;
    }
    case 'hybrid':
      return unitEffect('armored-car', safeLevel)
        + (safeLevel === 8 ? ' · MISSILE SITE' : '');
    case 'armored':
      return unitEffect('light-tank', safeLevel);
  }
}

export function technologyLevelUnlockText(branch: TechnologyBranch, level: number): string {
  if (level === 1) {
    return branch === 'training'
      ? 'Base · Missile: Support 8'
      : 'Base';
  }
  switch (branch) {
    case 'infantry':
      return `Infantry ${level} · Barracks ${level}`;
    case 'resources':
      return level >= 3
        ? `Engineer ${level} · Barracks ${level} · Infrastructure ${level - 1}`
        : `Engineer ${level} · Barracks ${level}`;
    case 'resourceBuildings':
      return `Resource sites ${level}`;
    case 'training':
      return `Buildings ${level} · Missile: Support 8`;
    case 'hybrid':
      return level === 8
        ? 'Cars + artillery 8 · Missile site'
        : `Cars + artillery ${level} · Plant/Ordnance ${level}`;
    case 'armored':
      return `Tanks ${level} · Plant ${level}`;
  }
}

export const TECHNOLOGY_BRANCH_PRESENTATION: Readonly<Record<TechnologyBranch, TechnologyBranchPresentation>> = {
  infantry: presentBranch({
    id: 'infantry',
    title: 'Infantry',
    iconUrl: technologyAsset('infantry'),
    levels: eightLevels(),
  }),
  resources: presentBranch({
    id: 'resources',
    title: 'Engineers',
    iconUrl: technologyAsset('resources'),
    levels: eightLevels(),
  }),
  resourceBuildings: presentBranch({
    id: 'resourceBuildings',
    title: 'Infrastructure',
    iconUrl: technologyAsset('resource-buildings'),
    levels: eightLevels(),
  }),
  training: presentBranch({
    id: 'training',
    title: 'Training',
    iconUrl: technologyAsset('training'),
    levels: eightLevels(),
  }),
  hybrid: presentBranch({
    id: 'hybrid',
    title: 'Support',
    iconUrl: technologyAsset('hybrid'),
    levels: eightLevels(),
  }),
  armored: presentBranch({
    id: 'armored',
    title: 'Armor',
    iconUrl: technologyAsset('armored'),
    levels: eightLevels(),
  }),
};

export function technologyLevelState(
  currentLevel: number,
  candidateLevel: number,
  researchingTarget?: number,
): TechnologyLevelVisualState {
  if (candidateLevel < currentLevel) return 'completed';
  if (candidateLevel === currentLevel) return 'current';
  if (candidateLevel === researchingTarget) return 'researching';
  if (candidateLevel === currentLevel + 1) return 'available';
  return 'locked';
}

export function defaultTechnologyInspectionLevel(currentLevel: number): number {
  return Math.min(8, currentLevel + 1);
}

/** Implements the horizontal ARIA tab-list order, including end wrapping. */
export function technologyTabAfterKey(
  currentBranch: TechnologyCategory,
  key: string,
): TechnologyCategory | null {
  const branches: readonly TechnologyCategory[] = [
    'infantry',
    'resources',
    'training',
    'hybrid',
    'armored',
    'navy',
    'airforce',
  ];
  if (key === 'Home') return branches[0];
  if (key === 'End') return branches[branches.length - 1];
  if (key !== 'ArrowLeft' && key !== 'ArrowRight') return null;
  const currentIndex = branches.indexOf(currentBranch);
  const direction = key === 'ArrowRight' ? 1 : -1;
  return branches[(currentIndex + direction + branches.length) % branches.length];
}

const romanLevel = (level: number): string => ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'][level - 1] ?? String(level);

export function buildTechnologyPanelModel(
  technology: TechnologyView,
  selectedBranch: TechnologyBranch,
  inspectedLevel = defaultTechnologyInspectionLevel(technology.levels[selectedBranch]),
): TechnologyPanelModel {
  const branch = TECHNOLOGY_BRANCH_PRESENTATION[selectedBranch];
  const currentLevel = technology.levels[selectedBranch];
  const selectedResearch = technology.slots.find((slot) => slot?.branch === selectedBranch) ?? undefined;
  const activeTarget = selectedResearch?.targetLevel;
  const levels = branch.levels.map((level) => {
    const state = technologyLevelState(currentLevel, level.level, activeTarget);
    const levelQuote = technology.levelQuotes[selectedBranch][level.level - 1];
    return {
      ...level,
      state: state === 'available' && levelQuote?.lockedReason ? 'locked' as const : state,
    };
  });
  const safeInspection = Math.max(1, Math.min(8, Math.round(inspectedLevel)));
  const inspected = levels[safeInspection - 1];
  const active = selectedResearch ? {
    branch: selectedResearch.branch,
    percent: Math.round(Math.max(0, Math.min(1, selectedResearch.progress)) * 100),
    etaSeconds: selectedResearch.etaSeconds,
  } : undefined;
  const quote = technology.quotes[selectedBranch];

  let blockedReason: string | undefined;
  if (technology.pending) blockedReason = 'Pending';
  else if (inspected.level <= currentLevel) blockedReason = 'Unlocked';
  else if (inspected.level !== currentLevel + 1) blockedReason = `Need ${romanLevel(currentLevel + 1)}`;
  else if (selectedResearch) blockedReason = 'Active';
  else if (quote.lockedReason) blockedReason = quote.lockedReason;
  else if (technology.slots.every(Boolean)) blockedReason = 'No free slot';
  else if (!quote.affordable) blockedReason = 'Not enough resources';

  return {
    branch,
    currentLevel,
    levels,
    inspected,
    canResearch: !blockedReason,
    ...(blockedReason ? { blockedReason } : {}),
    ...(active ? { active } : {}),
  };
}
