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
  readonly name: string;
  readonly summary: string;
  readonly authorization: string;
  readonly effect: string;
  readonly hours: number;
  readonly visualUrl: string;
}

export interface TechnologyBranchPresentation {
  readonly id: TechnologyBranch;
  readonly label: string;
  readonly title: string;
  readonly fileCode: string;
  readonly summary: string;
  readonly discipline: string;
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
    readonly title: string;
    readonly percent: number;
    readonly etaSeconds: number;
  };
}

type TechnologyLevelDraft = Omit<TechnologyLevelBriefing, 'effect' | 'hours' | 'visualUrl'>;

const briefing = (
  level: number,
  name: string,
  summary: string,
  authorization: string,
): TechnologyLevelDraft => ({ level, name, summary, authorization });

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
  return `${Number(ratio.toFixed(2))}×`;
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
    `${multiplier(unit.maxHp, base.maxHp)} HP`,
    `${multiplier(unit.attack.soft, base.attack.soft)} firepower`,
    `${multiplier(unit.speed, base.speed)} movement`,
    `${multiplier(unit.buildCost.funds ?? 0, base.buildCost.funds ?? 0)} build cost`,
    `${multiplier(unit.upkeep.fundsPerHour ?? 0, base.upkeep.fundsPerHour ?? 0)} upkeep`,
    `${multiplier(unit.buildWork, base.buildWork)} build work`,
  ].join(' · ');
};

/** Numeric dossier effect copy derived from the simulation's live balance tables. */
export function technologyLevelEffectText(branch: TechnologyBranch, level: number): string {
  const safeLevel = Math.max(1, Math.min(8, Math.round(level)));
  switch (branch) {
    case 'infantry':
      return `Infantry Level ${safeLevel}: ${unitEffect('infantry', safeLevel)}.`;
    case 'resources':
      return `Engineer Level ${safeLevel}: ${unitEffect('engineer', safeLevel)}.`;
    case 'resourceBuildings':
      return `Resource site Tier ${safeLevel}: ${RESOURCE_TIER_PASSIVE[safeLevel]}/h passive · `
        + `${RESOURCE_TIER_ENGINEER_CAP[safeLevel]} engineers · `
        + `${RESOURCE_TIER_ENGINEER_MULTIPLIER[safeLevel]}× engineer output.`;
    case 'training': {
      const rate = UNIT_PRODUCTION_RATE_BY_LEVEL[safeLevel];
      return `Facility Tier ${safeLevel}: ${rate} work/h (${multiplier(rate, UNIT_PRODUCTION_RATE_BY_LEVEL[1])} throughput) `
        + 'for Barracks, Tank Plant, Ordnance Workshop, and authorized Missile Sites.';
    }
    case 'hybrid':
      return `Armored Car and Artillery Level ${safeLevel}: ${unitEffect('armored-car', safeLevel)}`
        + (safeLevel === 8 ? ' · Missile Site authorization and strategic warheads.' : '.');
    case 'armored':
      return `Light and Medium Tank Level ${safeLevel}: ${unitEffect('light-tank', safeLevel)}.`;
  }
}

export function technologyLevelUnlockText(branch: TechnologyBranch, level: number): string {
  if (level === 1) {
    return branch === 'training'
      ? 'Baseline Tier 1 military facilities; Missile Sites also require Mobile Support Level VIII.'
      : 'Baseline — always available.';
  }
  switch (branch) {
    case 'infantry':
      return `Infantry Level ${level} — also needs Barracks Tier ${level}.`;
    case 'resources':
      return level >= 3
        ? `Engineer Level ${level} — also needs Barracks Tier ${level} and Resource Infrastructure Level ${level - 1}.`
        : `Engineer Level ${level} — also needs Barracks Tier ${level}.`;
    case 'resourceBuildings':
      return `Tier ${level} fields, quarries, mines and oil pumps where local resource potential supports it.`;
    case 'training':
      return `Tier ${level} Barracks, Tank Plant, Ordnance Workshop, and Missile Site; Missile Sites also require Mobile Support Level VIII.`;
    case 'hybrid':
      return level === 8
        ? 'Armored Car & Artillery Level 8, and the Missile Site.'
        : `Armored Car & Artillery Level ${level} — also needs Tank Plant/Ordnance Tier ${level}.`;
    case 'armored':
      return `Light & Medium Tank Level ${level} — also needs Tank Plant Tier ${level}.`;
  }
}

export const TECHNOLOGY_BRANCH_PRESENTATION: Readonly<Record<TechnologyBranch, TechnologyBranchPresentation>> = {
  infantry: presentBranch({
    id: 'infantry',
    label: 'Infantry',
    title: 'Infantry Doctrine',
    fileCode: 'GS / INF',
    summary: 'Refine the line formation through better weapons handling, field communications, and resilient defensive doctrine.',
    discipline: 'Line combat · endurance · fieldcraft',
    iconUrl: technologyAsset('infantry'),
    levels: [
      briefing(1, 'Standing Army', 'Establishes the common drill and equipment standard for regular formations.', 'Infantry I'),
      briefing(2, 'Section Drill', 'Improves fire discipline and small-unit movement under battlefield pressure.', 'Infantry II'),
      briefing(3, 'Support Sections', 'Integrates crew-served weapons into the line company command structure.', 'Infantry III'),
      briefing(4, 'Field Signals', 'Shortens the time between observation, orders, and coordinated action.', 'Infantry IV'),
      briefing(5, 'Combined Fire Plan', 'Coordinates rifles, support weapons, and maneuver around a single fire plan.', 'Infantry V'),
      briefing(6, 'Veteran Cadres', 'Preserves experienced leaders and spreads hard-won field practice.', 'Infantry VI'),
      briefing(7, 'Elastic Defense', 'Trades ground deliberately while preserving cohesion for the counterstroke.', 'Infantry VII'),
      briefing(8, 'Modern Line Doctrine', 'Completes a mature doctrine for durable, well-coordinated infantry armies.', 'Infantry VIII'),
    ],
  }),
  resources: presentBranch({
    id: 'resources',
    label: 'Resources',
    title: 'Resource Engineering',
    fileCode: 'MPE / RES',
    summary: 'Organize engineers, surveys, and regional works to draw more value from every strategic deposit.',
    discipline: 'Engineering · extraction · logistics',
    iconUrl: technologyAsset('resources'),
    levels: [
      briefing(1, 'Pioneer Corps', 'Forms the basic engineering detachments used to develop national resources.', 'Engineer I'),
      briefing(2, 'Field Survey', 'Standardizes geological survey teams and site planning before work begins.', 'Engineer II'),
      briefing(3, 'Mechanised Excavation', 'Introduces powered equipment and disciplined maintenance at working sites.', 'Engineer III'),
      briefing(4, 'Industrial Geology', 'Links field surveys with national production forecasts and transport plans.', 'Engineer IV'),
      briefing(5, 'Deep Extraction', 'Supports more difficult seams, wells, and quarries with specialist equipment.', 'Engineer V'),
      briefing(6, 'Regional Processing', 'Moves sorting and preparation closer to the source to reduce wasted haulage.', 'Engineer VI'),
      briefing(7, 'Strategic Reserves', 'Coordinates high-output sites around long-term wartime reserve targets.', 'Engineer VII'),
      briefing(8, 'National Extraction Board', 'Unifies engineering standards and resource planning across the country.', 'Engineer VIII'),
    ],
  }),
  resourceBuildings: presentBranch({
    id: 'resourceBuildings',
    label: 'Infrastructure',
    title: 'Resource Infrastructure',
    fileCode: 'MPE / INFRA',
    summary: 'Build the surveys, extraction works, storage depots, and transport links that turn local deposits into strategic supply.',
    discipline: 'Extraction sites · railheads · strategic reserves',
    iconUrl: technologyAsset('resource-buildings'),
    levels: [
      briefing(1, 'Local Works', 'Establishes surveyed fields, quarries, mines, and pumps under common engineering rules.', 'Tier I resource sites'),
      briefing(2, 'Mechanical Handling', 'Adds powered loading gear and conveyors to move bulk material with fewer delays.', 'Tier II resource sites'),
      briefing(3, 'Industrial Railheads', 'Connects extraction sites to dependable sidings, yards, and regional freight schedules.', 'Tier III resource sites'),
      briefing(4, 'Deep Works', 'Supports reinforced shafts, drainage pumps, and safer operations below difficult ground.', 'Tier IV resource sites'),
      briefing(5, 'Regional Processing', 'Moves crushing, sorting, and preparation closer to each producing district.', 'Tier V resource sites'),
      briefing(6, 'Integrated Depots', 'Combines silos, tank farms, warehouses, and switching yards into resilient hubs.', 'Tier VI resource sites'),
      briefing(7, 'Strategic Reserves', 'Protects fuel and material reserves in dispersed, guarded, and concealed storage.', 'Tier VII resource sites'),
      briefing(8, 'National Works Board', 'Coordinates every extraction district through a single national infrastructure plan.', 'Tier VIII resource sites'),
    ],
  }),
  training: presentBranch({
    id: 'training',
    label: 'Training',
    title: 'Training & Industry',
    fileCode: 'MOI / TRG',
    summary: 'Expand military establishments, technical schools, and factory methods to field advanced formations faster.',
    discipline: 'Facilities · instruction · throughput',
    iconUrl: technologyAsset('training'),
    levels: [
      briefing(1, 'Basic Establishments', 'Defines the first permanent training grounds and military workshops.', 'Tier I military facilities'),
      briefing(2, 'Standardized Tooling', 'Reduces rework by issuing common gauges, fixtures, and production drawings.', 'Tier II military facilities'),
      briefing(3, 'Shift Instruction', 'Trains replacement crews alongside active production shifts.', 'Tier III military facilities'),
      briefing(4, 'Specialist Schools', 'Creates dedicated schools for armor, artillery, and technical personnel.', 'Tier IV military facilities'),
      briefing(5, 'Assembly Doctrine', 'Turns proven factory practice into repeatable national standards.', 'Tier V military facilities'),
      briefing(6, 'Technical Cadres', 'Distributes experienced instructors and foremen between new establishments.', 'Tier VI military facilities'),
      briefing(7, 'Distributed Production', 'Coordinates specialized plants as one resilient production network.', 'Tier VII military facilities'),
      briefing(8, 'Total War Industry', 'Completes a mature system for sustained high-level military output.', 'Tier VIII military facilities'),
    ],
  }),
  hybrid: presentBranch({
    id: 'hybrid',
    label: 'Mobile support',
    title: 'Mobile Support',
    fileCode: 'GS / MOB',
    summary: 'Bind reconnaissance, field artillery, radio procedure, and mobile maintenance into one support arm.',
    discipline: 'Reconnaissance · artillery · strategic systems',
    iconUrl: technologyAsset('hybrid'),
    levels: [
      briefing(1, 'Recon Troops', 'Provides the baseline armored reconnaissance and field artillery establishment.', 'Armored Car I and Artillery I'),
      briefing(2, 'Forward Observers', 'Improves the speed and accuracy of reports from the advancing screen.', 'Armored Car II and Artillery II'),
      briefing(3, 'Mobile Workshops', 'Keeps support vehicles and guns operational farther from fixed depots.', 'Armored Car III and Artillery III'),
      briefing(4, 'Motorized Signals', 'Links reconnaissance reports to artillery commands over mobile radio nets.', 'Armored Car IV and Artillery IV'),
      briefing(5, 'Counter-battery Office', 'Organizes observation and firing data against hostile artillery positions.', 'Armored Car V and Artillery V'),
      briefing(6, 'Armored Reconnaissance', 'Combines speed, protection, and disciplined reporting at operational depth.', 'Armored Car VI and Artillery VI'),
      briefing(7, 'Mechanized Support', 'Coordinates guns, scouts, and repair columns behind mobile formations.', 'Armored Car VII and Artillery VII'),
      briefing(8, 'Strategic Systems', 'Extends the support arm into the country’s most advanced delivery systems.', 'Armored Car VIII, Artillery VIII, and Missile Sites'),
    ],
  }),
  armored: presentBranch({
    id: 'armored',
    label: 'Armored',
    title: 'Armored Warfare',
    fileCode: 'GS / ARM',
    summary: 'Develop protected mobility through stronger vehicles, reliable engines, improved guns, and radio-led command.',
    discipline: 'Protection · mobility · breakthrough',
    iconUrl: technologyAsset('armored'),
    levels: [
      briefing(1, 'Tank Companies', 'Establishes the first common organization for light and medium armor.', 'Light Tank I and Medium Tank I'),
      briefing(2, 'Improved Suspension', 'Raises cross-country reliability without sacrificing formation pace.', 'Light Tank II and Medium Tank II'),
      briefing(3, 'High-velocity Guns', 'Improves anti-armor performance through better guns and ammunition handling.', 'Light Tank III and Medium Tank III'),
      briefing(4, 'Radio Coordination', 'Lets dispersed vehicles maneuver as a formation instead of isolated machines.', 'Light Tank IV and Medium Tank IV'),
      briefing(5, 'Sloped Protection', 'Uses armor geometry and internal layout to improve battlefield survival.', 'Light Tank V and Medium Tank V'),
      briefing(6, 'Recovery Doctrine', 'Returns damaged vehicles to service through organized repair and recovery units.', 'Light Tank VI and Medium Tank VI'),
      briefing(7, 'Armored Breakthrough', 'Concentrates protected firepower against a chosen operational seam.', 'Light Tank VII and Medium Tank VII'),
      briefing(8, 'Deep Armored Operations', 'Completes the doctrine for sustained armored action beyond the first battle.', 'Light Tank VIII and Medium Tank VIII'),
    ],
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
    title: `${branch.title} · Level ${romanLevel(selectedResearch.targetLevel)}`,
    percent: Math.round(Math.max(0, Math.min(1, selectedResearch.progress)) * 100),
    etaSeconds: selectedResearch.etaSeconds,
  } : undefined;
  const quote = technology.quotes[selectedBranch];

  let blockedReason: string | undefined;
  if (technology.pending) blockedReason = 'Research order awaiting confirmation.';
  else if (inspected.level <= currentLevel) blockedReason = 'Technology already unlocked.';
  else if (inspected.level !== currentLevel + 1) blockedReason = `Develop Level ${romanLevel(currentLevel + 1)} first.`;
  else if (selectedResearch) blockedReason = `${branch.title} Level ${romanLevel(selectedResearch.targetLevel)} is already in development.`;
  else if (quote.lockedReason) blockedReason = quote.lockedReason;
  else if (technology.slots.every(Boolean)) blockedReason = 'Both research slots are occupied.';
  else if (!quote.affordable) blockedReason = 'Insufficient resources.';

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
