/**
 * In-game strategic command UI.
 *
 * Builds the player HUD once, then updates cached nodes from a single
 * coalesced `render(state)` driven by `UiStore` subscription. No animation
 * loop, no `getBoundingClientRect` in rAF, no MutationObserver, no
 * Unicode/emoji icons. Map/renderer effects go through typed `GameUiActions`.
 *
 * On-map junction markers are a GPU instanced layer inside the renderer; this
 * module never projects or positions them.
 */

import './game-ui.css';
import { QUALITY_LEVELS, QUALITY_PRESETS, type QualityLevel } from '../graphics/quality';
import { renderSelectedArmyPanel, type ArmyPanelCommand } from './army';
import { createFlag } from './flags';
import { createIcon, type IconName } from './icons';
import { createDiplomacyPanel } from './diplomacy-panel';
import { buildNotification } from './notifications';
import { groupQueueItems, type QueueGroup } from './queue-presentation';
import { bindTooltip } from './tooltip';
import { createUnitPortrait, UNIT_ROLE_NOTE } from './unit-portraits';
import type {
  MapMode, NavId, ProvinceResourceTotals, QueueItem, StrategicUiState, TechnologyBranch, UiStore,
} from './ui-state';

export interface GameUiActions {
  setMapMode(mode: MapMode): void;
  clearSelection(): void;
  setQuality(level: QualityLevel): void;
  navSelect(id: NavId): void;
  selectDiplomacyCountry(countryId: number): void;
  sendDiplomaticMessage(countryId: number, body: string): void;
  proposeAlliance(countryId: number): void;
  offerPeace(countryId: number): void;
  declareWar(countryId: number): void;
  endAlliance(countryId: number): void;
  respondDiplomacy(proposalId: string, accept: boolean): void;
  dismissNotification(id: string): void;
  togglePause(open: boolean): void;
  returnToMenu(): void;
  /** Arm map-click targeting for a strategic strike (the Warheads chip / N key). */
  armStrike?: () => void;
  focusSelected?: () => void;
  /** Re-centre the camera on a world point (locatable notifications). */
  focusWorld?: (x: number, z: number) => void;
  zoomMap?: (factor: number) => void;
  /** Selected-army orders. 'deselect' clears the selection. */
  armyCommand(command: ArmyPanelCommand): void;
  /** Queue a unit in the selected (own) province. */
  produceUnit(provinceId: number, unitTypeId: string): void;
  /** Start a building in the selected (own, urban) province. */
  buildStructure(provinceId: number, buildingId: string): void;
  /** Arm map-click placement of a production city's rally point, or clear it. */
  rallyPoint(provinceId: number, action: 'arm' | 'clear'): void;
  researchTechnology(branch: TechnologyBranch): void;
}
export interface GameUiHandle {
  destroy(): void;
}

const MAP_MODES: ReadonlyArray<{ mode: MapMode; label: string; icon: IconName }> = [
  { mode: 'balanced', label: 'Strategic', icon: 'mode-strategic' },
  { mode: 'political', label: 'Political', icon: 'mode-political' },
  { mode: 'diplomacy', label: 'Diplomacy', icon: 'mode-diplomacy' },
  { mode: 'clear', label: 'Terrain', icon: 'mode-terrain' },
];

// Only near-term-meaningful sections. A finished game should not advertise a
// wall of unavailable systems; the rest arrive with their subsystems.
const DOCK_SECTIONS: ReadonlyArray<{ id: NavId; label: string; icon: IconName }> = [
  { id: 'research', label: 'Technology', icon: 'objectives' },
  { id: 'diplomacy', label: 'Diplomacy', icon: 'diplomacy' },
  { id: 'economy', label: 'Economy', icon: 'economy' },
  { id: 'events', label: 'Objectives', icon: 'objectives' },
];

const RESOURCE_CHIPS: ReadonlyArray<{ key: keyof ProvinceResourceTotals; label: string; icon: IconName }> = [
  { key: 'stone', label: 'Stone', icon: 'node-stone' },
  { key: 'metal', label: 'Metal', icon: 'node-metal' },
  { key: 'oil', label: 'Oil', icon: 'node-oil' },
];

/** Mirrors game/phase.ts's PHASE_LABELS — kept local rather than imported
 *  since the UI only ever sees the projected tier number, never game-core. */
const COUNTRY_PHASE_LABELS: Record<number, string> = { 1: 'Phase I', 2: 'Phase II', 3: 'Phase III' };

const TECHNOLOGY_UI: ReadonlyArray<{
  id: TechnologyBranch; label: string; icon: IconName; description: string; unlocks: string;
}> = [
  { id: 'infantry', label: 'Infantry', icon: 'stat-troops', description: 'Stronger line infantry with improved health, speed and firepower.', unlocks: 'Infantry levels' },
  { id: 'resources', label: 'Resources', icon: 'resource-overlay', description: 'Better engineers and higher-output fields, quarries, mines and oil pumps.', unlocks: 'Engineers · resource buildings' },
  { id: 'training', label: 'Training', icon: 'industry', description: 'Higher-level training facilities dramatically accelerate advanced units.', unlocks: 'Barracks · plants · workshops' },
  { id: 'hybrid', label: 'Hybrid', icon: 'unit-armored-car', description: 'Mobile support doctrine for reconnaissance vehicles, artillery and late strategic systems.', unlocks: 'Armored cars · artillery · nuclear systems at VIII' },
  { id: 'armored', label: 'Armored', icon: 'unit-medium-tank', description: 'Improved armor, engines and guns for tank formations.', unlocks: 'Light and medium tanks' },
];

/** Real, always-available province fields (populated per selection). */
const PROVINCE_FIELDS = ['Allegiance', 'Terrain', 'Deposits', 'Extraction'] as const;
type ProvinceFieldKey = (typeof PROVINCE_FIELDS)[number];

const FACILITY_CHIPS: ReadonlyArray<{
  key: 'barracks' | 'tankPlant' | 'ordnance' | 'missileSite'; label: string; icon: IconName;
}> = [
  { key: 'barracks', label: 'Barracks', icon: 'structure-barracks' },
  { key: 'tankPlant', label: 'Tank plant', icon: 'structure-plant' },
  { key: 'ordnance', label: 'Ordnance works', icon: 'structure-ordnance' },
  { key: 'missileSite', label: 'Missile site', icon: 'structure-ordnance' },
];

/** Building id → 0 A.D. facility icon, for the graphical Build row. */
const FACILITY_ICON: Record<string, IconName> = {
  barracks: 'structure-barracks',
  tankPlant: 'structure-plant',
  ordnance: 'structure-ordnance',
  missileSite: 'structure-ordnance',
};

/** Compact painted marks for production types that lacked button icons. */
const UNIT_PRODUCTION_ICON: Readonly<Partial<Record<string, IconName>>> = {
  engineer: 'unit-engineer',
  'armored-car': 'unit-armored-car',
  'light-tank': 'unit-light-tank',
  'medium-tank': 'unit-medium-tank',
};

/** Building id → one-line note for the Build tooltip. */
const FACILITY_NOTE: Record<string, string> = {
  barracks: 'Trains infantry and engineers.',
  tankPlant: 'Builds armoured cars and tanks.',
  ordnance: 'Builds artillery and heavy ordnance.',
  missileSite: 'Stockpiles strategic warheads and launches strikes within range.',
};

const numberFormat = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/**
 * "7s" / "7m 12s" / "1h 03m" — unit-labelled so a short build can't be misread
 * as minutes. Seconds are dropped once we're into hours (nobody counts them
 * there) and the minutes are zero-padded so the width stays stable.
 */
function formatEta(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

/**
 * Persistent visual state for one 0 A.D.-style queue slot. 0 A.D.'s
 * selection panel keeps its queue button and resizes a progress overlay;
 * keeping these nodes stable gives the browser transition real endpoints.
 */
interface QueueSlot {
  readonly root: HTMLDivElement;
  readonly mask: HTMLSpanElement;
  readonly count: HTMLSpanElement;
  readonly meta: HTMLDivElement;
  readonly percent: HTMLSpanElement;
  readonly eta: HTMLSpanElement;
  readonly bar: HTMLDivElement;
  readonly fill: HTMLElement;
  item: QueueGroup;
}

interface QueueView {
  readonly slots: Map<string, QueueSlot>;
  orderKey: string;
}

const queueViews = new WeakMap<HTMLElement, QueueView>();

function createQueueSlot(
  item: QueueGroup, thumbFor: (id: string, label: string) => HTMLElement,
): QueueSlot {
  const root = el('div', 'ifg-queue__item');
  root.setAttribute('role', 'listitem');

  const portrait = el('div', 'ifg-queue__portrait');
  const mask = el('span', 'ifg-queue__progress-mask');
  mask.setAttribute('aria-hidden', 'true');
  const count = el('span', 'ifg-queue__count');
  count.setAttribute('aria-hidden', 'true');
  portrait.append(thumbFor(item.id, item.label), mask, count);

  const percent = el('span', 'ifg-queue__percent');
  const eta = el('span', 'ifg-queue__eta');
  const status = el('div', 'ifg-queue__status');
  status.append(percent, eta);
  const bar = el('div', 'ifg-queue__bar');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  const fill = el('i');
  bar.append(fill);
  const meta = el('div', 'ifg-queue__meta');
  meta.append(status, bar);
  root.append(portrait, meta);

  const slot: QueueSlot = { root, mask, count, meta, percent, eta, bar, fill, item };
  bindTooltip(root, () => {
    const current = slot.item;
    const queued = current.count > 1 ? ` · ${current.count - 1} queued` : '';
    return {
      title: current.label,
      status: current.active
        ? `${Math.round(current.progress * 100)}% · ${formatEta(current.etaSeconds)} left${queued}`
        : current.count > 1 ? `${current.count} queued` : 'Queued',
    };
  });
  return slot;
}

/**
 * Update persistent queue slots in place. Progress ticks never replace the
 * artwork or fill nodes, so the clipped overlay and bar can move smoothly.
 */
function updateQueue(
  container: HTMLElement, items: readonly import('./ui-state').QueueItem[],
  thumbFor: (id: string, label: string) => HTMLElement,
): void {
  const grouped = groupQueueItems(items);
  let view = queueViews.get(container);
  if (!view) {
    view = { slots: new Map(), orderKey: '' };
    queueViews.set(container, view);
  }

  const liveKeys = new Set(grouped.map((item) => item.key));
  for (const key of view.slots.keys()) {
    if (!liveKeys.has(key)) view.slots.delete(key);
  }

  const roots = grouped.map((item) => {
    let slot = view.slots.get(item.key);
    if (!slot) {
      slot = createQueueSlot(item, thumbFor);
      view.slots.set(item.key, slot);
    }
    slot.item = item;

    const progress = Math.max(0, Math.min(100, Math.round(item.progress * 100)));
    slot.root.classList.toggle('is-active', item.active);
    slot.root.classList.toggle('is-queued', !item.active);
    slot.root.dataset.count = String(item.count);
    slot.meta.hidden = !item.active;
    slot.count.hidden = item.count < 2;
    slot.count.textContent = `×${item.count}`;
    slot.mask.style.transform = `translateY(${item.active ? progress : 0}%)`;
    slot.fill.style.width = `${progress}%`;
    slot.percent.textContent = `${progress}%`;
    slot.eta.textContent = `${formatEta(item.etaSeconds)} left`;
    slot.bar.setAttribute('aria-valuenow', String(progress));
    slot.bar.setAttribute('aria-label', `${item.label} progress`);
    slot.root.setAttribute('aria-label', item.active
      ? `${item.label}, ${progress} percent, ${formatEta(item.etaSeconds)} remaining${item.count > 1 ? `, ${item.count - 1} more queued` : ''}`
      : `${item.label}, ${item.count > 1 ? `${item.count} orders queued` : 'queued'}`);
    return slot.root;
  });

  const nextOrderKey = grouped.map((item) => item.key).join('|');
  if (view.orderKey !== nextOrderKey) {
    container.replaceChildren(...roots);
    view.orderKey = nextOrderKey;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

export function mountGameUi(store: UiStore, actions: GameUiActions): GameUiHandle {
  const root = el('div', 'ifg');
  root.hidden = true;

  const mapControls = el('nav', 'ifg-map-controls');
  mapControls.setAttribute('aria-label', 'Map controls');
  const zoomOut = el('button', 'ifg-map-controls__button', '-');
  zoomOut.type = 'button';
  zoomOut.title = 'Zoom out';
  zoomOut.setAttribute('aria-label', 'Zoom out');
  zoomOut.addEventListener('click', () => actions.zoomMap?.(Math.exp(0.22)));
  const zoomIn = el('button', 'ifg-map-controls__button', '+');
  zoomIn.type = 'button';
  zoomIn.title = 'Zoom in';
  zoomIn.setAttribute('aria-label', 'Zoom in');
  zoomIn.addEventListener('click', () => actions.zoomMap?.(Math.exp(-0.22)));
  mapControls.append(zoomIn, zoomOut);
  root.append(mapControls);

  // ---------------- top strategic bar ----------------
  const topbar = el('header', 'ifg-topbar');
  topbar.setAttribute('aria-label', 'Strategic command bar');

  const countryBlock = el('div', 'ifg-topbar__country');
  let flagHost = el('span', 'ifg-topbar__flag');
  const countryName = el('strong', 'ifg-topbar__country-name', 'Unassigned Command');
  countryBlock.append(flagHost, countryName);

  const resourceStrip = el('div', 'ifg-topbar__resources');
  resourceStrip.setAttribute('role', 'group');
  resourceStrip.setAttribute('aria-label', 'National resources');
  const resourceIcon: Partial<Record<string, IconName>> = {
    money: 'funds', manpower: 'manpower', food: 'food',
    stone: 'node-stone', metal: 'metal', oil: 'oil',
    warheads: 'structure-ordnance',
  };
  // What each resource is for and how it's obtained, for the resource-chip
  // tooltip. Money/manpower/food accrue passively (scale with owned
  // territory/population); stone/metal/oil only accrue while a stack is
  // actively extracting a deposit; warheads accrue from Ordnance Workshops
  // and Missile Sites over time.
  const RESOURCE_DESCRIPTION: Partial<Record<string, string>> = {
    money: 'Funds war spending; passive income from owned territory.',
    manpower: 'Fuels recruitment; passive income from population.',
    food: 'Feeds your population; passive income from territory.',
    stone: 'Builds structures; only while a stack extracts a deposit.',
    metal: 'Arms production; only while a stack extracts a deposit.',
    oil: 'Fuels vehicles; only while a stack extracts a deposit.',
    warheads: 'Strike ordnance; accrues from Ordnance Workshops/Missile Sites.',
  };

  const clockBlock = el('div', 'ifg-topbar__clock');
  const clockText = el('span', 'ifg-clock__text');
  const clockDay = el('b', 'ifg-clock__day', 'Day --');
  const clockZone = el('small', 'ifg-clock__zone', 'GMT+2');
  clockText.append(clockDay, clockZone);
  const clockFace = el('span', 'ifg-clock__face');
  clockFace.setAttribute('role', 'img');
  for (let index = 0; index < 12; index += 1) {
    const marker = el('i', 'ifg-clock__marker');
    marker.style.setProperty('--clock-marker', `${index * 30}deg`);
    clockFace.append(marker);
  }
  const hourHand = el('i', 'ifg-clock__hand ifg-clock__hand--hour');
  const minuteHand = el('i', 'ifg-clock__hand ifg-clock__hand--minute');
  const secondHand = el('i', 'ifg-clock__hand ifg-clock__hand--second');
  clockFace.append(hourHand, minuteHand, secondHand, el('i', 'ifg-clock__pin'));
  clockBlock.append(clockText, clockFace);

  const weatherChip = el('span', 'ifg-topbar__weather');
  weatherChip.title = 'Weather';
  weatherChip.append(createIcon('weather-clear'));

  const systemButton = el('button', 'ifg-topbar__system');
  systemButton.type = 'button';
  systemButton.title = 'System menu';
  systemButton.setAttribute('aria-label', 'Open system menu');
  systemButton.append(createIcon('system'));
  systemButton.addEventListener('click', () => actions.togglePause(!store.get().paused));

  topbar.append(countryBlock, resourceStrip, weatherChip, clockBlock, systemButton);

  // ---------------- floating command dock (top-left, short) ----------------
  const dock = el('nav', 'ifg-dock');
  dock.setAttribute('aria-label', 'Command');

  const dockButtons = new Map<NavId, HTMLButtonElement>();
  for (const section of DOCK_SECTIONS) {
    const b = el('button', 'ifg-dock__btn');
    b.type = 'button';
    const available = section.id === 'research' || section.id === 'diplomacy';
    b.disabled = !available;
    b.dataset.nav = section.id;
    b.title = `${section.label} — not available yet`;
    b.setAttribute('aria-label', `${section.label} (not available yet)`);
    if (available) {
      b.title = section.label;
      b.setAttribute('aria-label', section.label);
      b.setAttribute('aria-controls', section.id === 'research' ? 'ifg-technology-panel' : 'ifg-diplomacy-panel');
      b.setAttribute('aria-expanded', 'false');
    }
    b.append(createIcon(section.icon), el('span', 'ifg-dock__tip', section.label));
    b.addEventListener('click', () => actions.navSelect(section.id));
    dockButtons.set(section.id, b);
  }
  dock.append(...dockButtons.values());

  const diplomacyPanel = createDiplomacyPanel({
    close: () => actions.navSelect('diplomacy'),
    selectCountry: actions.selectDiplomacyCountry,
    sendMessage: actions.sendDiplomaticMessage,
    proposeAlliance: actions.proposeAlliance,
    offerPeace: actions.offerPeace,
    declareWar: actions.declareWar,
    endAlliance: actions.endAlliance,
    respondProposal: actions.respondDiplomacy,
  });

  // ---------------- technology: one active no-cost project ----------------
  const technologyPanel = el('section', 'ifg-tech');
  technologyPanel.id = 'ifg-technology-panel';
  technologyPanel.hidden = true;
  technologyPanel.setAttribute('role', 'dialog');
  technologyPanel.setAttribute('aria-modal', 'false');
  technologyPanel.setAttribute('aria-label', 'Technology');
  const techHead = el('header', 'ifg-tech__head');
  techHead.append(el('span', 'ifg-tech__eyebrow', 'National development'), el('h2', undefined, 'Technology'));
  const techClose = el('button', 'ifg-tech__close');
  techClose.type = 'button';
  techClose.setAttribute('aria-label', 'Close technology');
  techClose.append(createIcon('close'));
  techClose.addEventListener('click', () => actions.navSelect('research'));
  techHead.append(techClose);
  const techTabs = el('div', 'ifg-tech__tabs');
  techTabs.setAttribute('role', 'tablist');
  const techBody = el('div', 'ifg-tech__body');
  technologyPanel.append(techHead, techTabs, techBody);
  let selectedTechTab: TechnologyBranch = 'infantry';
  let techRenderKey = '';
  const renderTechnology = (state: StrategicUiState): void => {
    const activeKey = state.technology.active
      ? `${state.technology.active.branch}:${state.technology.active.targetLevel}:${Math.round(state.technology.active.progress * 1000)}:${Math.round(state.technology.active.etaSeconds)}` : '-';
    const nextKey = `${selectedTechTab}|${Object.values(state.technology.levels).join(',')}|${activeKey}|${state.technology.pending}`;
    if (nextKey === techRenderKey) return;
    techRenderKey = nextKey;
    const current = TECHNOLOGY_UI.find((branch) => branch.id === selectedTechTab)!;
    techTabs.replaceChildren(...TECHNOLOGY_UI.map((branch) => {
      const tab = el('button', 'ifg-tech__tab');
      tab.type = 'button';
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(branch.id === selectedTechTab));
      tab.classList.toggle('is-active', branch.id === selectedTechTab);
      tab.append(createIcon(branch.icon), el('span', undefined, branch.label), el('b', undefined, `L${state.technology.levels[branch.id]}`));
      tab.onclick = () => { selectedTechTab = branch.id; renderTechnology(store.get()); };
      return tab;
    }));
    const level = state.technology.levels[current.id];
    const active = state.technology.active;
    const hero = el('div', 'ifg-tech__branch');
    hero.append(createIcon(current.icon, 'ifg-tech__branch-icon'));
    const copy = el('span', 'ifg-tech__branch-copy');
    copy.append(el('h3', undefined, current.label), el('p', undefined, current.description), el('small', undefined, current.unlocks));
    hero.append(copy);
    const track = el('div', 'ifg-tech__track');
    for (let candidate = 1; candidate <= 8; candidate += 1) {
      const node = el('div', 'ifg-tech__node');
      node.classList.toggle('is-complete', candidate <= level);
      node.classList.toggle('is-next', candidate === level + 1);
      node.append(el('strong', undefined, String(candidate)), el('small', undefined, candidate === 1 ? 'Available' : `${[0, 0, 6, 10, 16, 24, 32, 40, 48][candidate]}h`));
      track.append(node);
    }
    const action = el('div', 'ifg-tech__action');
    if (active) {
      const activeDef = TECHNOLOGY_UI.find((branch) => branch.id === active.branch)!;
      const status = el('div', 'ifg-tech__status');
      status.append(el('b', undefined, `${activeDef.label} Level ${active.targetLevel}`), el('small', undefined, `${Math.round(active.progress * 100)}% · ${formatEta(active.etaSeconds)} remaining`));
      const bar = el('span', 'ifg-tech__bar');
      const fill = el('i'); fill.style.width = `${Math.round(active.progress * 100)}%`; bar.append(fill);
      status.append(bar); action.append(status);
    } else if (level < 8) {
      const start = el('button', 'ifg-tech__start', `Develop Level ${level + 1}`);
      start.type = 'button';
      start.disabled = state.technology.pending === true;
      start.onclick = () => actions.researchTechnology(current.id);
      action.append(start, el('small', undefined, 'No resources required · one project at a time'));
    } else {
      action.append(el('strong', 'ifg-tech__max', 'Branch fully developed'));
    }
    techBody.replaceChildren(hero, track, action);
  };

  // ---------------- map-mode cluster (top-right) ----------------
  const modeCluster = el('div', 'ifg-modes');
  modeCluster.setAttribute('role', 'group');
  modeCluster.setAttribute('aria-label', 'Map mode');
  const modeButtons = new Map<MapMode, HTMLButtonElement>();
  for (const { mode, label, icon } of MAP_MODES) {
    const button = el('button', 'ifg-modes__item');
    button.type = 'button';
    button.dataset.mode = mode;
    button.title = label;
    button.append(createIcon(icon), el('span', 'ifg-modes__label', label));
    button.addEventListener('click', () => actions.setMapMode(mode));
    modeButtons.set(mode, button);
    modeCluster.append(button);
  }
  // ---------------- notifications ----------------
  const notifyStack = el('div', 'ifg-notify');
  notifyStack.setAttribute('aria-live', 'polite');
  notifyStack.setAttribute('aria-label', 'Events');

  // ---------------- selected province card (compact, bottom-left) ----------------
  const provinceCard = el('section', 'ifg-card ifg-card--province');
  provinceCard.hidden = true;
  provinceCard.setAttribute('aria-live', 'polite');

  const pvName = el('strong', 'ifg-card__title', '');
  const pvSub = el('span', 'ifg-card__sub', '');
  const pvClose = el('button', 'ifg-card__close');
  pvClose.type = 'button';
  pvClose.title = 'Clear selection';
  pvClose.setAttribute('aria-label', 'Clear selection');
  pvClose.append(createIcon('close'));
  pvClose.addEventListener('click', () => actions.clearSelection());

  const pvFlagHost = el('span', 'ifg-card__flag');
  const pvHead = el('header', 'ifg-card__head');
  const pvHeadText = el('span', 'ifg-card__headtext');
  pvHeadText.append(pvName, pvSub);

  const pvFocusBtn = el('button', 'ifg-card__iconbtn');
  pvFocusBtn.type = 'button';
  pvFocusBtn.title = 'Centre map on province';
  pvFocusBtn.setAttribute('aria-label', 'Centre map on province');
  pvFocusBtn.append(createIcon('focus'));
  if (actions.focusSelected) {
    pvFocusBtn.addEventListener('click', () => actions.focusSelected?.());
  } else {
    pvFocusBtn.disabled = true;
    pvFocusBtn.title = 'Centre map — not available yet';
  }
  pvHead.append(pvFlagHost, pvHeadText, pvFocusBtn, pvClose);

  const pvGrid = el('div', 'ifg-card__grid');
  const pvFieldValue = new Map<ProvinceFieldKey, HTMLElement>();
  for (const label of PROVINCE_FIELDS) {
    const cell = el('span', 'ifg-field');
    const value = el('b', undefined, '--');
    cell.append(el('small', undefined, label), value);
    pvFieldValue.set(label, value);
    pvGrid.append(cell);
  }

  // FACILITIES — production structures standing in the province (own only).
  const pvFacilities = el('div', 'ifg-card__facilities');
  pvFacilities.hidden = true;
  pvFacilities.append(el('small', 'ifg-card__restitle', 'Facilities'));
  const pvFacChips = el('div', 'ifg-card__facchips');
  const pvFacChipByKey = new Map<string, { card: HTMLElement; level: HTMLElement }>();
  for (const { key, label, icon } of FACILITY_CHIPS) {
    const card = el('article', 'ifg-facility-card');
    card.title = label;
    const level = el('small', 'ifg-facility-card__level', 'L1');
    card.append(createIcon(icon, 'ifg-facility-card__icon'), el('b', 'ifg-facility-card__name', label), level);
    pvFacChipByKey.set(key, { card, level });
    pvFacChips.append(card);
  }
  pvFacilities.append(pvFacChips);

  // RESOURCES — deposit abundance in the province (not production/day). Hidden
  // when the province holds no known deposits, or (under fog) for foreign land.
  const pvResources = el('div', 'ifg-card__resources');
  pvResources.hidden = true;
  pvResources.append(el('small', 'ifg-card__restitle', 'Deposits'));
  const pvResChips = el('div', 'ifg-card__reschips');
  const pvResChipByKey = new Map<keyof ProvinceResourceTotals, { chip: HTMLElement; value: HTMLElement }>();
  for (const { key, label, icon } of RESOURCE_CHIPS) {
    const chip = el('span', 'ifg-rchip');
    chip.title = `${label} deposits (strategic abundance)`;
    chip.append(createIcon(icon, 'ifg-rchip__icon'));
    const value = el('b', 'ifg-rchip__value', '0');
    chip.append(value);
    pvResChipByKey.set(key, { chip, value });
    pvResChips.append(chip);
  }
  const pvCoastalChip = el('span', 'ifg-rchip ifg-rchip--coastal');
  pvCoastalChip.title = 'Sea access';
  pvCoastalChip.append(createIcon('resource-water', 'ifg-rchip__icon'), el('b', 'ifg-rchip__value', 'Coast'));
  pvCoastalChip.hidden = true;
  pvResChips.append(pvCoastalChip);
  pvResources.append(pvResChips);
  const pvResStatus = el('small', 'ifg-card__resstatus');
  pvResStatus.hidden = true;
  pvResources.append(pvResStatus);

  // PRODUCE — real unit queue for an owned province with the right building.
  const pvProduce = el('div', 'ifg-card__resources ifg-card__queue-section');
  pvProduce.hidden = true;
  pvProduce.append(el('small', 'ifg-card__restitle', 'Training'));
  const pvQueue = el('div', 'ifg-queue ifg-queue--production');
  pvQueue.setAttribute('role', 'list');
  pvQueue.setAttribute('aria-label', 'Unit production queue');
  pvQueue.hidden = true;
  pvProduce.append(pvQueue);
  const pvRally = el('div', 'ifg-card__actions');
  pvRally.hidden = true;
  const pvRallyBtn = el('button', 'ifg-card__act');
  pvRallyBtn.type = 'button';
  const pvRallyClear = el('button', 'ifg-card__act');
  pvRallyClear.type = 'button';
  pvRallyClear.textContent = 'Clear rally';
  pvRally.append(pvRallyBtn, pvRallyClear);
  pvProduce.append(pvRally);

  // BUILD — construct a production building in an owned urban province.
  const pvBuild = el('div', 'ifg-card__resources ifg-card__queue-section');
  pvBuild.hidden = true;
  const pvBuildTitle = el('small', 'ifg-card__restitle', 'Build');
  pvBuild.append(pvBuildTitle);
  const pvConstruction = el('div', 'ifg-queue ifg-queue--construction');
  pvConstruction.setAttribute('role', 'list');
  pvConstruction.setAttribute('aria-label', 'Building construction queue');
  pvConstruction.hidden = true;
  pvBuild.append(pvConstruction);

  const pvOverview = el('div', 'ifg-card__overview');
  pvOverview.append(pvFacilities, pvResources);
  const pvActivity = el('div', 'ifg-card__activity');
  pvActivity.append(pvProduce, pvBuild, pvRally);
  const pvBody = el('div', 'ifg-card__body');
  pvBody.append(pvGrid, pvOverview, pvActivity);
  provinceCard.append(pvHead, pvBody);

  // Large, thumb-friendly commands float above the compact card. They open a
  // client-only chooser and continue to call the existing game actions.
  const pvCommandBar = el('div', 'ifg-province-commands');
  pvCommandBar.hidden = true;
  const makeProvinceCommand = (label: string, icon: IconName): HTMLButtonElement => {
    const button = el('button', 'ifg-province-command');
    button.type = 'button';
    button.append(createIcon(icon, 'ifg-province-command__icon'), el('span', 'ifg-province-command__label', label));
    const progress = el('span', 'ifg-province-command__progress');
    progress.append(el('i'));
    button.append(progress);
    return button;
  };
  const pvTrainCommand = makeProvinceCommand('Train', 'stat-troops');
  const pvBuildCommand = makeProvinceCommand('Build', 'industry');
  pvCommandBar.append(pvTrainCommand, pvBuildCommand);
  const paintProvinceCommand = (
    button: HTMLButtonElement, defaultLabel: string, defaultIcon: IconName,
    active: QueueItem | undefined, itemIcon: IconName | undefined,
  ): void => {
    const icon = itemIcon ? createIcon(itemIcon, 'ifg-province-command__icon')
      : active ? createUnitPortrait(active.id, active.label)
      : createIcon(defaultIcon, 'ifg-province-command__icon');
    icon.classList.add('ifg-province-command__icon');
    const label = el('span', 'ifg-province-command__label', active ? active.label : defaultLabel);
    const progress = el('span', 'ifg-province-command__progress');
    const fill = el('i');
    fill.style.width = `${Math.round((active?.progress ?? 0) * 100)}%`;
    progress.append(fill);
    if (active) {
      button.classList.add('is-progressing');
      button.setAttribute('aria-label', `${active.label}, ${Math.round(active.progress * 100)} percent, ${formatEta(active.etaSeconds)} remaining`);
    } else {
      button.classList.remove('is-progressing');
      button.setAttribute('aria-label', defaultLabel);
    }
    button.replaceChildren(icon, label, progress);
  };

  const pvPicker = el('div', 'ifg-province-picker');
  pvPicker.hidden = true;
  pvPicker.setAttribute('role', 'dialog');
  pvPicker.setAttribute('aria-modal', 'true');
  const pvPickerCard = el('section', 'ifg-province-picker__card');
  const pvPickerTitle = el('h2', 'ifg-province-picker__title');
  const pvPickerClose = el('button', 'ifg-province-picker__close');
  pvPickerClose.type = 'button';
  pvPickerClose.setAttribute('aria-label', 'Close');
  pvPickerClose.append(createIcon('close'));
  const pvPickerHead = el('header', 'ifg-province-picker__head');
  pvPickerHead.append(pvPickerTitle, pvPickerClose);
  const pvPickerList = el('div', 'ifg-province-picker__list');
  pvPickerCard.append(pvPickerHead, pvPickerList);
  pvPicker.append(pvPickerCard);
  const closeProvincePicker = (): void => { pvPicker.hidden = true; };
  let optimisticTrain: QueueItem | undefined;
  let optimisticBuild: QueueItem | undefined;
  pvPickerClose.addEventListener('click', closeProvincePicker);
  pvPicker.addEventListener('click', (event) => { if (event.target === pvPicker) closeProvincePicker(); });

  const openProvincePicker = (mode: 'train' | 'build'): void => {
    const selected = store.get().selectedProvince;
    if (!selected || !selected.isOwn) return;
    const options = mode === 'train' ? (selected.producible ?? []) : (selected.buildable ?? []);
    pvPickerTitle.textContent = mode === 'train' ? `Train in ${selected.name}` : `Build in ${selected.name}`;
    pvPicker.setAttribute('aria-label', pvPickerTitle.textContent);
    pvPickerList.replaceChildren(...options.map((option) => {
      const button = el('button', 'ifg-province-picker__option');
      button.type = 'button';
      const family = option.id.replace(/-l[2-8]$/, '');
      const icon = mode === 'build' ? FACILITY_ICON[option.id] : UNIT_PRODUCTION_ICON[family];
      const thumb = icon ? createIcon(icon, 'ifg-province-picker__thumb') : createUnitPortrait(option.id, option.name);
      thumb.classList.add('ifg-province-picker__thumb');
      const copy = el('span', 'ifg-province-picker__copy');
      copy.append(el('b', undefined, option.name), el('small', undefined, option.costLabel));
      button.append(thumb, copy);
      button.disabled = selected.commandPending === true || !option.affordable || !option.available;
      button.classList.toggle('is-locked', !option.available);
      bindTooltip(button, () => ({
        title: option.name,
        description: mode === 'build' ? FACILITY_NOTE[option.id] : UNIT_ROLE_NOTE[family],
        cost: option.costLabel,
        disabledReason: option.reason ?? (!option.affordable ? `Not enough resources — needs ${option.costLabel}.` : undefined),
      }));
      if (option.affordable && option.available) button.addEventListener('click', () => {
        closeProvincePicker();
        const optimistic: QueueItem = { id: option.id, label: option.name, active: true, progress: 0, etaSeconds: 0 };
        if (mode === 'train') {
          optimisticTrain = optimistic;
          paintProvinceCommand(pvTrainCommand, 'Train', 'stat-troops', optimistic, UNIT_PRODUCTION_ICON[family]);
          actions.produceUnit(selected.id, option.id);
        } else {
          optimisticBuild = optimistic;
          paintProvinceCommand(pvBuildCommand, 'Build', 'industry', optimistic, FACILITY_ICON[option.id]);
          actions.buildStructure(selected.id, option.id);
        }
      });
      return button;
    }));
    pvPicker.hidden = false;
    pvPickerList.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  };
  pvTrainCommand.addEventListener('click', () => openProvincePicker('train'));
  pvBuildCommand.addEventListener('click', () => openProvincePicker('build'));

  // ---------------- centered selected-army command overlay ----------------
  const armyCard = el('section', 'ifg-army-panel');
  armyCard.hidden = true;
  armyCard.setAttribute('aria-live', 'polite');

  // ---------------- local system/settings overlay ----------------
  const overlay = el('div', 'ifg-overlay');
  overlay.hidden = true;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'System menu');
  const overlayCard = el('div', 'ifg-overlay__card');
  overlayCard.innerHTML =
    '<header class="ifg-overlay__head"><small>Local Controls</small><h2>System &amp; Settings</h2></header>';

  const resumeButton = el('button', 'ifg-overlay__primary', 'Return to Map');
  resumeButton.type = 'button';
  resumeButton.addEventListener('click', () => actions.togglePause(false));

  const qualityGroup = el('div', 'ifg-overlay__group');
  qualityGroup.setAttribute('role', 'group');
  qualityGroup.setAttribute('aria-label', 'Graphics quality');
  qualityGroup.append(el('small', undefined, 'Graphics quality'));
  const qualitySeg = el('div', 'ifg-seg');
  const qualityButtons = new Map<QualityLevel, HTMLButtonElement>();
  for (const level of QUALITY_LEVELS) {
    const button = el('button', 'ifg-seg__item');
    button.type = 'button';
    button.dataset.quality = level;
    button.textContent = QUALITY_PRESETS[level].label;
    button.addEventListener('click', () => actions.setQuality(level));
    qualityButtons.set(level, button);
    qualitySeg.append(button);
  }
  const qualityBlurb = el('p', 'ifg-overlay__blurb', '');
  const qualityScope = el('p', 'ifg-overlay__blurb ifg-overlay__blurb--muted',
    'Affects world rendering — terrain detail, trees, buildings, render sharpness. '
    + 'Most visible zoomed in. The HUD, army markers and country names stay the '
    + 'same size at every setting.');
  qualityGroup.append(qualitySeg, qualityBlurb, qualityScope);

  const secondary = el('div', 'ifg-overlay__secondary');
  for (const [label, reason, enabled] of [
    ['More settings (main menu)', 'Full settings live in the main menu for now.', false],
    ['Save', 'The operation autosaves on the server — there is no manual save yet.', false],
    ['Return to Main Menu', 'The operation keeps autosaving in the background — you can resume it from the menu.', true],
  ] as const) {
    const row = el('div', 'ifg-overlay__link-row');
    const b = el('button', 'ifg-overlay__link', label);
    b.type = 'button';
    b.disabled = !enabled;
    b.title = reason;
    if (enabled) b.addEventListener('click', () => actions.returnToMenu());
    row.append(b, el('small', 'ifg-overlay__link-reason', reason));
    secondary.append(row);
  }
  const diagLine = el('p', 'ifg-overlay__diag', '');
  overlayCard.append(resumeButton, qualityGroup, secondary, diagLine);
  overlay.append(overlayCard);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) actions.togglePause(false);
  });

  root.append(topbar, dock, diplomacyPanel.element, technologyPanel, modeCluster, notifyStack, pvCommandBar, provinceCard, armyCard, pvPicker, overlay);
  document.body.append(root);

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && store.get().phase === 'in-game') {
      if (!pvPicker.hidden) {
        event.preventDefault();
        closeProvincePicker();
        return;
      }
      if (store.get().activeSidePanel) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const panel = store.get().activeSidePanel;
        if (panel) actions.navSelect(panel);
        return;
      }
      actions.togglePause(!store.get().paused);
    }
  };
  window.addEventListener('keydown', onKey);

  // ---------------- render (store-coalesced) ----------------
  // Cache keys so a patch that did not change a given slice does no DOM work
  // (the clock patches on every in-game minute; nothing below it should churn).
  let resourceSlots = '';
  let notifyKey = '';
  let armyKey = '';
  let flagKey = '';
  let weatherKey = '';
  let pvFlagKey = '';
  let pvResourceKey = '';
  let selectedProvinceId: number | null = null;
  let renderedSidePanel: StrategicUiState['activeSidePanel'] = null;

  const render = (state: StrategicUiState): void => {
    root.hidden = state.phase !== 'in-game';
    root.dataset.phase = state.phase;
    const diplomacyOpen = state.activeSidePanel === 'diplomacy';
    const diplomacyDockButton = dockButtons.get('diplomacy');
    if (diplomacyDockButton) {
      diplomacyDockButton.classList.toggle('is-on', diplomacyOpen);
      diplomacyDockButton.setAttribute('aria-expanded', String(diplomacyOpen));
      diplomacyDockButton.setAttribute('aria-pressed', String(diplomacyOpen));
    }
    diplomacyPanel.render(diplomacyOpen, state.diplomacy);
    const technologyOpen = state.activeSidePanel === 'research';
    technologyPanel.hidden = !technologyOpen;
    if (technologyOpen) renderTechnology(state);
    if (renderedSidePanel === 'diplomacy' && state.activeSidePanel === null) {
      diplomacyDockButton?.focus({ preventScroll: true });
    }
    renderedSidePanel = state.activeSidePanel;
    for (const [id, button] of dockButtons) {
      const on = id === state.activeSidePanel;
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', String(on));
    }

    // `.brand { display:flex }` beats [hidden]; override inline, re-asserted so
    // it outlasts the menu launch transition.
    const brand = document.querySelector<HTMLElement>('.brand');
    if (brand) brand.style.display = state.phase === 'in-game' ? 'none' : '';

    // Country identity — real flag, colour standard only as fallback.
    const pc = state.playerCountry;
    countryName.textContent = pc ? pc.name : 'Unassigned Command';
    const nextFlagKey = `${pc?.name ?? ''}|${pc?.color ?? ''}`;
    if (nextFlagKey !== flagKey) {
      flagKey = nextFlagKey;
      const nextFlag = createFlag(pc?.name ?? null, pc?.color ?? '#8a8f88', 'command');
      flagHost.replaceWith(nextFlag);
      nextFlag.classList.add('ifg-topbar__flag');
      flagHost = nextFlag;
    }

    // Resources — icon + value chips.
    const slots = state.resources.map((r) => r.id).join(',');
    if (slots !== resourceSlots) {
      resourceStrip.replaceChildren(...state.resources.map((line) => {
        // The Warheads chip doubles as the strike trigger — activating it arms
        // map-click targeting, the same order the N key gives. Kept as a <span>
        // (not <button>) so it inherits the chip styling unchanged.
        const chip = el('span', 'ifg-res');
        chip.dataset.res = line.id;
        if (line.id === 'warheads' && actions.armStrike) {
          const arm = actions.armStrike;
          chip.classList.add('is-actionable');
          chip.setAttribute('role', 'button');
          chip.tabIndex = 0;
          chip.style.cursor = 'pointer';
          chip.title = 'Launch strategic strike (or press N)';
          chip.addEventListener('click', () => arm());
          chip.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); arm(); }
          });
        }
        const ic = resourceIcon[line.id];
        if (ic) chip.append(createIcon(ic, 'ifg-res__icon'));
        const stack = el('span', 'ifg-res__stack');
        stack.append(el('b', 'ifg-res__value', ''), el('i', 'ifg-res__rate', ''));
        chip.append(stack);
        bindTooltip(chip, () => {
          const current = state.resources.find((resource) => resource.id === line.id);
          if (!current || current.value === null) return null;
          const percent = Math.round((current.coverage ?? 1) * 100);
          const pressure = Number((current.shortageSeverity ?? 0).toFixed(1));
          return {
            title: current.label,
            description: RESOURCE_DESCRIPTION[current.id],
            children: [
              { label: 'Production', value: `${current.production ?? 0} /h` },
              { label: 'Upkeep demand', value: `${current.upkeep ?? 0} /h`, content: {
                title: `${current.label} demand`,
                description: 'Completed units consume upkeep continuously. Reserves cover deficits before shortage pressure rises.',
              } },
              { label: 'Net', value: `${(current.delta ?? 0) >= 0 ? '+' : ''}${current.delta ?? 0} /h` },
              { label: 'Coverage', value: `${percent}%` },
              { label: 'Reserve horizon', value: current.reserveHours == null ? 'Stable' : `${current.reserveHours.toFixed(1)} h` },
              { label: 'Pressure', value: `${pressure}%`, content: {
                title: `${current.label} shortage pressure`,
                description: pressure > 0 ? 'Unit penalties grow from catalog-defined curves.' : 'No active shortage penalty.',
                children: [
                  { label: 'Trend', value: percent < 100 ? 'Rising' : pressure > 0 ? 'Recovering' : 'Stable' },
                  { label: 'Zero-supply collapse', value: '24 h' },
                  { label: 'Full recovery', value: '12 h' },
                ],
              } },
            ],
          };
        });
        return chip;
      }));
      resourceSlots = slots;
    }
    for (const line of state.resources) {
      const chip = resourceStrip.querySelector<HTMLElement>(`[data-res="${line.id}"]`);
      if (!chip) continue;
      const pending = line.value === null;
      chip.classList.toggle('is-pending', pending);
      chip.classList.toggle('is-demo', Boolean(line.demo));
      chip.querySelector('.ifg-res__value')!.textContent =
        pending ? '--' : numberFormat.format(line.value as number);
      // Income rate, per game hour. `null`/undefined = no rate model for this
      // resource yet (blank); a number (incl. 0) is authoritative.
      const rateEl = chip.querySelector<HTMLElement>('.ifg-res__rate')!;
      const rate = line.delta;
      if (pending || rate === null || rate === undefined) {
        rateEl.textContent = '';
        rateEl.classList.remove('is-positive', 'is-negative');
      } else {
        const rounded = Number(rate.toFixed(1));
        rateEl.textContent = `${rounded >= 0 ? '+' : ''}${rounded} /h`;
        rateEl.classList.toggle('is-positive', rounded > 0);
        rateEl.classList.toggle('is-negative', rounded < 0);
      }
      const description = RESOURCE_DESCRIPTION[line.id];
      chip.dataset.summary = pending
        ? `${line.label} — economy not implemented yet`
        : `${line.label}${line.demo ? ' (demo)' : ''}${
          rate === null || rate === undefined ? '' : ` · ${Number(rate.toFixed(1))} per game hour`}${
          description ? ` — ${description}` : ''}`;
    }

    // Clock + weather.
    const clock = state.clock;
    clockDay.textContent = clock ? `Day ${clock.day}` : 'Day --';
    if (clock) {
      const hourAngle = ((clock.hour % 12) + clock.minute / 60 + clock.second / 3_600) * 30;
      const minuteAngle = (clock.minute + clock.second / 60) * 6;
      const secondAngle = clock.second * 6;
      hourHand.style.transform = `translateX(-50%) rotate(${hourAngle}deg)`;
      minuteHand.style.transform = `translateX(-50%) rotate(${minuteAngle}deg)`;
      secondHand.style.transform = `translateX(-50%) rotate(${secondAngle}deg)`;
      const wholeSecond = Math.floor(clock.second);
      const accessibleTime = `${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}:${String(wholeSecond).padStart(2, '0')}`;
      const offsetHours = Math.abs(clock.utcOffsetMinutes / 60);
      const zone = `GMT${clock.utcOffsetMinutes >= 0 ? '+' : '-'}${offsetHours}`;
      clockFace.setAttribute('aria-label', `Day ${clock.day}, ${accessibleTime}, ${zone}`);
      clockZone.textContent = zone;
    } else {
      clockFace.setAttribute('aria-label', 'Game clock unavailable');
    }
    const nextWeatherKey = `${state.weather.raining}|${state.weather.label}`;
    if (nextWeatherKey !== weatherKey) {
      weatherKey = nextWeatherKey;
      weatherChip.replaceChildren(createIcon(state.weather.raining ? 'weather-rain' : 'weather-clear'));
      weatherChip.title = `Weather — ${state.weather.label}`;
      weatherChip.classList.toggle('is-rain', state.weather.raining);
    }

    // Map modes.
    for (const [mode, button] of modeButtons) {
      const active = mode === state.mapMode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }

    // Selected province card.
    const province = state.selectedProvince;
    const army = state.selectedArmy;
    if ((province?.id ?? null) !== selectedProvinceId) {
      selectedProvinceId = province?.id ?? null;
      optimisticTrain = undefined;
      optimisticBuild = undefined;
      closeProvincePicker();
    }
    provinceCard.hidden = !province;
    pvCommandBar.hidden = !province?.isOwn;
    if (!province) closeProvincePicker();
    if (province) {
      const ownTag = province.isOwn === true ? ' · Your territory'
        : province.isOwn === false ? ' · Foreign' : '';
      pvName.textContent = province.name;
      pvSub.textContent = `${province.owner} · ${province.terrain}${ownTag}`;
      provinceCard.classList.toggle('is-foreign', province.isOwn === false);
      const nextPvFlagKey = `${province.owner}|${province.ownerColor}`;
      if (nextPvFlagKey !== pvFlagKey) {
        pvFlagKey = nextPvFlagKey;
        pvFlagHost.replaceChildren(createFlag(province.owner, province.ownerColor, 'inline'));
      }
      // Owner colour drives the panel's left edge, matching the army panel.
      provinceCard.style.setProperty('--pv-country', province.ownerColor || 'var(--ifg-brass)');

      // Real, always-present fields (replaces the old --/pending placeholders).
      const depositKinds = province.resources
        ? (['stone', 'metal', 'oil'] as const).filter((k) => province.resources![k] > 0)
        : [];
      pvFieldValue.get('Allegiance')!.textContent = province.isOwn === true
        ? (province.occupied ? 'Your command (occupied)' : 'Your command')
        : province.isOwn === false ? province.owner : '—';
      pvFieldValue.get('Terrain')!.textContent = province.terrain || '—';
      const physical = province.resourceEconomy;
      pvFieldValue.get('Deposits')!.textContent = physical
        ? (['food', 'stone', 'metal', 'oil'] as const).map((key) => {
          const tier = physical.productionBreakdown?.[key];
      const tierText = tier ? ` L${tier.currentTier}/${tier.maximumTier}` : '';
          return `${key[0].toUpperCase()}${key.slice(1)} ${Math.round(physical.potential[key] * 100)}%${tierText}`;
        }).join(' · ')
        : depositKinds.length
        ? depositKinds.map((k) => k[0].toUpperCase() + k.slice(1)).join(' · ')
        : province.isOwn === false ? 'Unknown' : 'None';
      // Plain-language: either an engineer is mining, or the action the player
      // needs to take is to send one. "Controlled / Uncontrolled" read as jargon.
      pvFieldValue.get('Extraction')!.textContent = physical?.productionBreakdown
        ? (['food', 'stone', 'metal', 'oil'] as const).map((key) => {
          const value = physical.productionBreakdown![key];
          return `${key[0].toUpperCase()}${key.slice(1)} ${value.total.toFixed(1)}/h (${value.base.toFixed(1)} base + ${value.passive.toFixed(1)} infra + ${value.engineer.toFixed(1)} eng)`;
        }).join(' · ')
        : province.isOwn === false ? 'Unknown' : '—';

      // Facilities row — own provinces only, shown when at least one stands.
      const b = province.buildings;
      const anyFacility = Boolean(b && (b.barracks > 0 || b.tankPlant > 0 || b.ordnance > 0 || b.missileSite > 0));
      pvFacilities.hidden = !anyFacility;
      if (b) {
        for (const { key } of FACILITY_CHIPS) {
          const chip = pvFacChipByKey.get(key)!;
          chip.card.hidden = (b[key] ?? 0) <= 0;
          chip.level.textContent = `Level ${b[key] ?? 0}`;
        }
      }
      const res = province.resources;
      const dep = province.deposits ?? null;
      const nextPvResourceKey = [
        res ? `${res.stone}/${res.metal}/${res.oil}` : '-',
        province.coastal ? 'c' : '',
        dep ? `${dep.controlled ? 'C' : ''}${dep.extracting ? 'E' : ''}` : '',
        province.isOwn,
        (province.producible ?? []).map((u) => `${u.id}:${u.available}:${u.affordable}`).join(','),
        (province.queue ?? []).map((q) => `${q.id}:${Math.round(q.progress * 100)}:${Math.round(q.etaSeconds)}`).join(','),
        (province.buildable ?? []).map((b) => `${b.id}:${b.available}${b.affordable ? '+' : '-'}`).join(','),
        (province.construction ?? []).map((q) => `${q.id}:${Math.round(q.progress * 100)}:${Math.round(q.etaSeconds)}`).join(','),
        province.rally ? `${Math.round(province.rally.x)},${Math.round(province.rally.z)}` : '-',
        province.awaitingRallyTarget ? 'arm' : '',
        province.commandPending ? 'pending' : '',
        province.canSetRally ? 'rally-ok' : 'rally-blocked',
        physical?.productionBreakdown
          ? Object.values(physical.productionBreakdown).map((value) => `${value.total}:${value.currentTier}:${value.maximumTier}`).join(',')
          : '-',
      ].join('|');
      if (nextPvResourceKey !== pvResourceKey) {
        pvResourceKey = nextPvResourceKey;
        const hasDeposits = Boolean(res && (res.stone > 0 || res.metal > 0 || res.oil > 0));
        pvResources.hidden = !hasDeposits && !province.coastal;
        if (res) {
          for (const { key } of RESOURCE_CHIPS) {
            const slot = pvResChipByKey.get(key)!;
            const amount = res[key];
            slot.chip.hidden = amount <= 0;
            slot.value.textContent = numberFormat.format(amount);
          }
        } else {
          for (const { key } of RESOURCE_CHIPS) pvResChipByKey.get(key)!.chip.hidden = true;
        }
        pvCoastalChip.hidden = province.coastal !== true;

        // PRODUCE panel.
        const prod = province.producible ?? [];
        const q = province.queue ?? [];
        pvProduce.hidden = !(province.isOwn && q.length > 0);
        if (province.isOwn && prod.length > 0) {
          // Rally point: where finished units march. Placed by a map click.
          pvRally.hidden = false;
          pvRallyBtn.textContent = province.awaitingRallyTarget
            ? 'Click map…'
            : province.rally ? 'Move rally' : 'Set rally point';
          pvRallyBtn.classList.toggle('is-active', province.awaitingRallyTarget === true);
          pvRallyBtn.disabled = province.commandPending === true || province.canSetRally !== true;
          pvRallyBtn.onclick = () => actions.rallyPoint(province.id, 'arm');
          pvRallyClear.hidden = !province.rally;
          pvRallyClear.disabled = province.commandPending === true;
          pvRallyClear.onclick = () => actions.rallyPoint(province.id, 'clear');
        } else {
          pvRally.hidden = true;
        }
        pvQueue.hidden = q.length === 0;
        updateQueue(pvQueue, q, (id, label) => {
          const thumb = createUnitPortrait(id, label);
          thumb.classList.add('ifg-queue__thumb');
          return thumb;
        });

        // BUILD panel — offered buildings and anything under construction.
        const buildable = province.buildable ?? [];
        const construction = province.construction ?? [];
        pvBuild.hidden = !province.isOwn || construction.length === 0;
        if (!pvBuild.hidden) {
          const phaseLabel = state.countryPhase ? COUNTRY_PHASE_LABELS[state.countryPhase] : undefined;
          pvBuildTitle.textContent = phaseLabel ? `Construction · ${phaseLabel}` : 'Construction';
        }
        pvConstruction.hidden = construction.length === 0;
        updateQueue(pvConstruction, construction, (id, label) => {
          const icon = FACILITY_ICON[id];
          const thumb = icon ? createIcon(icon, 'ifg-queue__thumb ifg-icon') : el('span', 'ifg-queue__thumb');
          if (!icon) thumb.textContent = label.slice(0, 1);
          return thumb;
        });

        const queuedTraining = q.find((item) => item.active) ?? q[0];
        const queuedConstruction = construction.find((item) => item.active) ?? construction[0];
        if (queuedTraining) optimisticTrain = undefined;
        if (queuedConstruction) optimisticBuild = undefined;
        const activeTraining = queuedTraining ?? (province.commandPending ? optimisticTrain : undefined);
        const activeConstruction = queuedConstruction ?? (province.commandPending ? optimisticBuild : undefined);
        paintProvinceCommand(
          pvTrainCommand, 'Train', 'stat-troops', activeTraining,
          activeTraining ? UNIT_PRODUCTION_ICON[activeTraining.id.replace(/-l[2-8]$/, '')] : undefined,
        );
        paintProvinceCommand(
          pvBuildCommand, 'Build', 'industry', activeConstruction,
          activeConstruction ? FACILITY_ICON[activeConstruction.id] : undefined,
        );
        pvTrainCommand.disabled = province.commandPending === true || prod.length === 0;
        pvBuildCommand.disabled = province.commandPending === true || buildable.length === 0;

        if (dep && hasDeposits) {
          pvResStatus.hidden = false;
          pvResStatus.textContent = dep.extracting
            ? 'Extraction under way'
            : dep.controlled ? 'Controlled — secure with an army to extract' : 'Uncontrolled';
          pvResStatus.classList.toggle('is-active', dep.extracting);
        } else {
          pvResStatus.hidden = true;
        }
      }
    }

    // Army card — shown whenever a stack is selected (province takes priority).
    const showArmy = Boolean(army) && !province;
    armyCard.hidden = !showArmy;
    // Narrow re-render key: only the fields the panel actually paints. The clock
    // patches the store every in-game minute; a full JSON.stringify(army) here
    // rebuilt the whole panel (portraits included) on every one of those.
    const nextArmyKey = showArmy && army ? [
      army.id, army.identified, army.combat, army.targetingMode ?? '', army.activity,
      Math.round((army.health ?? 0) * 100), Math.round((army.strength ?? 0) * 100),
      army.unitCount, army.canMove, army.canAttack, army.canRetreat,
      army.canSplit, army.canStop, army.canExtract,
      army.legalRetreatExits?.length ?? 0,
      army.artillery?.targetArmyId ?? '',
      (army.groups ?? []).map((g) => `${g.typeId}:${g.count}:${Math.round(g.health * 100)}`).join(','),
      (army.battleFronts ?? []).map((front) =>
        `${front.id}:${Math.round(front.friendlyHp)}:${Math.round(front.enemyHp)}`).join(','),
    ].join('|') : '';
    if (nextArmyKey !== armyKey) {
      armyKey = nextArmyKey;
      if (showArmy && army) {
        renderSelectedArmyPanel(armyCard, army, (command) => actions.armyCommand(command));
      }
    }

    // Notifications.
    const nextNotifyKey = state.notifications.map((n) => n.id).join(',');
    if (nextNotifyKey !== notifyKey) {
      notifyStack.replaceChildren(...state.notifications.map(
        (n) => buildNotification(n, actions.dismissNotification, actions.focusWorld)));
      notifyKey = nextNotifyKey;
    }

    // This overlay only blocks local input; the authoritative simulation continues.
    overlay.hidden = !state.paused;
    for (const [level, button] of qualityButtons) {
      const active = level === state.quality;
      button.classList.toggle('is-selected', active);
      button.setAttribute('aria-pressed', String(active));
    }
    qualityBlurb.textContent = QUALITY_PRESETS[state.quality].blurb;
    diagLine.textContent =
      `Effective render scale ${state.effectiveRenderScale.toFixed(2)}x · ${state.quality.toUpperCase()}`;
  };

  render(store.get());
  const unsubscribe = store.subscribe(render);

  return {
    destroy() {
      unsubscribe();
      window.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
