/**
 * In-game strategic command UI (v2).
 *
 * Builds the player HUD once, then updates cached nodes from a single
 * coalesced `render(state)` driven by `UiStore` subscription. No animation
 * loop, no `getBoundingClientRect` in rAF, no MutationObserver, no
 * Unicode/emoji icons. Map/renderer effects go through typed `GameUiActions`.
 *
 * The on-map resource / junction markers are a GPU instanced layer inside the
 * renderer — this module never projects or positions them.
 */

import './game-ui.css';
import { QUALITY_LEVELS, QUALITY_PRESETS, type QualityLevel } from '../graphics/quality';
import { renderSelectedArmyPanel, type ArmyPanelCommand } from './army';
import { createFlag } from './flags';
import { createIcon, type IconName } from './icons';
import { buildNotification } from './notifications';
import { bindTooltip } from './tooltip';
import { createUnitPortrait, UNIT_ROLE_NOTE } from './unit-portraits';
import type {
  MapMode, NavId, ProvinceResourceTotals, StrategicUiState, UiStore,
} from './ui-state';

export interface GameUiActions {
  setMapMode(mode: MapMode): void;
  clearSelection(): void;
  setQuality(level: QualityLevel): void;
  navSelect(id: NavId): void;
  dismissNotification(id: string): void;
  togglePause(open: boolean): void;
  toggleResourceOverlay(on: boolean): void;
  returnToMenu(): void;
  openDebugInspector(): void;
  focusSelected?: () => void;
  /** Re-centre the camera on a world point (locatable notifications). */
  focusWorld?: (x: number, z: number) => void;
  /** Selected-army orders. 'deselect' clears the selection. */
  armyCommand(command: ArmyPanelCommand): void;
  /** Queue a unit in the selected (own) province. */
  produceUnit(provinceId: number, unitTypeId: string): void;
  /** Start a building in the selected (own, urban) province. */
  buildStructure(provinceId: number, buildingId: string): void;
  /** Arm map-click placement of a production city's rally point, or clear it. */
  rallyPoint(provinceId: number, action: 'arm' | 'clear'): void;
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
  { id: 'diplomacy', label: 'Diplomacy', icon: 'diplomacy' },
  { id: 'economy', label: 'Economy', icon: 'economy' },
  { id: 'events', label: 'Objectives', icon: 'objectives' },
];

const RESOURCE_CHIPS: ReadonlyArray<{ key: keyof ProvinceResourceTotals; label: string; icon: IconName }> = [
  { key: 'stone', label: 'Stone', icon: 'node-stone' },
  { key: 'metal', label: 'Metal', icon: 'node-metal' },
  { key: 'oil', label: 'Oil', icon: 'node-oil' },
];

const PROVINCE_ACTIONS = ['Build', 'Produce', 'Rally', 'Inspect'] as const;

/** Real, always-available province fields (populated per selection). */
const PROVINCE_FIELDS = ['Allegiance', 'Terrain', 'Deposits', 'Extraction'] as const;
type ProvinceFieldKey = (typeof PROVINCE_FIELDS)[number];

const FACILITY_CHIPS: ReadonlyArray<{
  key: 'barracks' | 'tankPlant' | 'ordnance'; label: string; icon: IconName;
}> = [
  { key: 'barracks', label: 'Barracks', icon: 'structure-barracks' },
  { key: 'tankPlant', label: 'Tank plant', icon: 'structure-plant' },
  { key: 'ordnance', label: 'Ordnance works', icon: 'structure-ordnance' },
];

/** Building id → 0 A.D. facility icon, for the graphical Build row. */
const FACILITY_ICON: Record<string, IconName> = {
  barracks: 'structure-barracks',
  tankPlant: 'structure-plant',
  ordnance: 'structure-ordnance',
};

/** Building id → one-line note for the Build tooltip. */
const FACILITY_NOTE: Record<string, string> = {
  barracks: 'Trains infantry and engineers.',
  tankPlant: 'Builds armoured cars and tanks.',
  ordnance: 'Builds artillery and heavy ordnance.',
};

const numberFormat = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

/** "1:02" / "0:45" — capped so a very long build never prints minutes > 99. */
function formatEta(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.min(99, Math.floor(s / 60));
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * A 0 A.D.-style production/construction queue: the active order gets a
 * thumbnail, a fill bar, and a countdown; anything queued behind it is a
 * smaller inert thumbnail. Rebuilt whenever the caller's cache key changes
 * (see the pvResourceKey gate) rather than diffed in place — a queue is at
 * most a handful of items.
 */
function renderQueue(
  container: HTMLElement, items: readonly import('./ui-state').QueueItem[],
  thumbFor: (id: string, label: string) => HTMLElement,
): void {
  container.replaceChildren(...items.map((item) => {
    const row = el('div', 'ifg-queue__item');
    row.classList.toggle('is-active', item.active);
    row.append(thumbFor(item.id, item.label));
    if (item.active) {
      const bar = el('div', 'ifg-queue__bar');
      const fill = el('i');
      fill.style.width = `${Math.round(item.progress * 100)}%`;
      bar.append(fill);
      const eta = el('span', 'ifg-queue__eta', formatEta(item.etaSeconds));
      const meta = el('div', 'ifg-queue__meta');
      meta.append(bar, eta);
      row.append(meta);
    }
    bindTooltip(row, () => ({
      title: item.label,
      status: item.active ? `${Math.round(item.progress * 100)}% — ${formatEta(item.etaSeconds)} left` : 'Queued',
    }));
    return row;
  }));
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

  topbar.append(countryBlock, resourceStrip, clockBlock, weatherChip, systemButton);

  // ---------------- floating command dock (top-left, short) ----------------
  const dock = el('nav', 'ifg-dock');
  dock.setAttribute('aria-label', 'Command');

  const overlayToggle = el('button', 'ifg-dock__btn ifg-dock__btn--primary');
  overlayToggle.type = 'button';
  overlayToggle.title = 'Resource deposits';
  overlayToggle.setAttribute('aria-label', 'Toggle resource deposits');
  overlayToggle.append(createIcon('resource-overlay'), el('span', 'ifg-dock__tip', 'Resources'));
  overlayToggle.addEventListener('click', () => actions.toggleResourceOverlay(!store.get().resourceOverlay));

  const expandBtn = el('button', 'ifg-dock__btn ifg-dock__expand');
  expandBtn.type = 'button';
  expandBtn.title = 'More';
  expandBtn.setAttribute('aria-expanded', 'false');
  expandBtn.append(createIcon('expand'));

  const dockMore = el('div', 'ifg-dock__more');
  dockMore.hidden = true;
  for (const section of DOCK_SECTIONS) {
    const b = el('button', 'ifg-dock__btn');
    b.type = 'button';
    b.disabled = true;
    b.dataset.nav = section.id;
    b.title = `${section.label} — not available yet`;
    b.setAttribute('aria-label', `${section.label} (not available yet)`);
    b.append(createIcon(section.icon), el('span', 'ifg-dock__tip', section.label));
    b.addEventListener('click', () => actions.navSelect(section.id));
    dockMore.append(b);
  }
  expandBtn.addEventListener('click', () => {
    const open = dockMore.hidden;
    dockMore.hidden = !open;
    expandBtn.setAttribute('aria-expanded', String(open));
    expandBtn.classList.toggle('is-open', open);
  });
  dock.append(overlayToggle, dockMore, expandBtn);

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
  const inspectorButton = el('button', 'ifg-modes__inspector', 'F3');
  inspectorButton.type = 'button';
  inspectorButton.title = 'World inspector';
  inspectorButton.hidden = true;
  inspectorButton.addEventListener('click', () => actions.openDebugInspector());
  modeCluster.append(inspectorButton);

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
  const pvFacChipByKey = new Map<string, HTMLElement>();
  for (const { key, label, icon } of FACILITY_CHIPS) {
    const chip = el('span', 'ifg-rchip');
    chip.title = label;
    chip.append(createIcon(icon, 'ifg-rchip__icon'), el('b', 'ifg-rchip__value', label));
    pvFacChipByKey.set(key, chip);
    pvFacChips.append(chip);
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
  const pvProduce = el('div', 'ifg-card__resources');
  pvProduce.hidden = true;
  pvProduce.append(el('small', 'ifg-card__restitle', 'Produce'));
  const pvProduceList = el('div', 'ifg-card__prodlist');
  pvProduce.append(pvProduceList);
  const pvQueue = el('div', 'ifg-queue');
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
  const pvBuild = el('div', 'ifg-card__resources');
  pvBuild.hidden = true;
  pvBuild.append(el('small', 'ifg-card__restitle', 'Build'));
  const pvBuildList = el('div', 'ifg-card__prodlist');
  pvBuild.append(pvBuildList);
  const pvConstruction = el('div', 'ifg-queue');
  pvConstruction.hidden = true;
  pvBuild.append(pvConstruction);

  const pvActions = el('div', 'ifg-card__actions');
  for (const label of PROVINCE_ACTIONS) {
    if (label === 'Produce' || label === 'Build') continue; // real panels above
    const b = el('button', 'ifg-card__act');
    b.type = 'button';
    b.textContent = label;
    b.disabled = true;
    b.title = `${label} — not available yet`;
    pvActions.append(b);
  }
  provinceCard.append(pvHead, pvGrid, pvFacilities, pvResources, pvProduce, pvBuild, pvActions);

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
  qualityGroup.append(qualitySeg, qualityBlurb);

  const secondary = el('div', 'ifg-overlay__secondary');
  for (const [label, title] of [
    ['More settings (main menu)', 'Full settings live in the main menu for now'],
    ['Save', 'Saving is not available yet'],
    ['Return to Main Menu', 'Returning to the menu mid-operation is not available yet'],
  ] as const) {
    const b = el('button', 'ifg-overlay__link', label);
    b.type = 'button';
    b.disabled = true;
    b.title = title;
    if (label.startsWith('Return')) b.addEventListener('click', () => actions.returnToMenu());
    secondary.append(b);
  }
  const diagLine = el('p', 'ifg-overlay__diag', '');
  overlayCard.append(resumeButton, qualityGroup, secondary, diagLine);
  overlay.append(overlayCard);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) actions.togglePause(false);
  });

  root.append(topbar, dock, modeCluster, notifyStack, provinceCard, armyCard, overlay);
  document.body.append(root);

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && store.get().phase === 'in-game') {
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

  const render = (state: StrategicUiState): void => {
    root.hidden = state.phase !== 'in-game';
    root.dataset.phase = state.phase;
    inspectorButton.hidden = !state.debugEnabled;

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
        const chip = el('span', 'ifg-res');
        chip.dataset.res = line.id;
        const ic = resourceIcon[line.id];
        if (ic) chip.append(createIcon(ic, 'ifg-res__icon'));
        const stack = el('span', 'ifg-res__stack');
        stack.append(el('b', 'ifg-res__value', ''), el('i', 'ifg-res__rate', ''));
        chip.append(stack);
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
      chip.title = pending
        ? `${line.label} — economy not implemented yet`
        : `${line.label}${line.demo ? ' (demo)' : ''}${
          rate === null || rate === undefined ? '' : ` · ${Number(rate.toFixed(1))} per game hour`}`;
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
      clockFace.setAttribute('aria-label', `Day ${clock.day}, ${accessibleTime}, GMT+2`);
      clockZone.textContent = `GMT${clock.utcOffsetMinutes >= 0 ? '+' : '-'}${Math.abs(clock.utcOffsetMinutes / 60)}`;
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

    // Resource overlay toggle state.
    overlayToggle.classList.toggle('is-on', state.resourceOverlay);
    overlayToggle.setAttribute('aria-pressed', String(state.resourceOverlay));

    // Selected province card.
    const province = state.selectedProvince;
    const army = state.selectedArmy;
    provinceCard.hidden = !province;
    if (province) {
      const ownTag = province.isOwn === true ? ' · Your territory'
        : province.isOwn === false ? ' · Foreign' : '';
      pvName.textContent = province.name;
      pvSub.textContent = `${province.owner} · ${province.terrain}${ownTag}`;
      provinceCard.classList.toggle('is-foreign', province.isOwn === false);
      // Command actions only make sense on land the player controls.
      pvActions.hidden = province.isOwn === false;
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
      pvFieldValue.get('Allegiance')!.textContent = province.isOwn === true ? 'Your command'
        : province.isOwn === false ? province.owner : '—';
      pvFieldValue.get('Terrain')!.textContent = province.terrain || '—';
      pvFieldValue.get('Deposits')!.textContent = depositKinds.length
        ? depositKinds.map((k) => k[0].toUpperCase() + k.slice(1)).join(' · ')
        : province.isOwn === false ? 'Unknown' : 'None';
      pvFieldValue.get('Extraction')!.textContent = !depositKinds.length ? '—'
        : province.deposits?.extracting ? 'Under way'
        : province.deposits?.controlled ? 'Controlled' : 'Uncontrolled';

      // Facilities row — own provinces only, shown when at least one stands.
      const b = province.buildings;
      const anyFacility = Boolean(b && (b.barracks > 0 || b.tankPlant > 0 || b.ordnance > 0));
      pvFacilities.hidden = !anyFacility;
      if (b) {
        for (const { key } of FACILITY_CHIPS) {
          pvFacChipByKey.get(key)!.hidden = (b[key] ?? 0) <= 0;
        }
      }
      const res = province.resources;
      const dep = province.deposits ?? null;
      const nextPvResourceKey = [
        res ? `${res.stone}/${res.metal}/${res.oil}` : '-',
        province.coastal ? 'c' : '',
        dep ? `${dep.controlled ? 'C' : ''}${dep.extracting ? 'E' : ''}` : '',
        province.isOwn,
        (province.producible ?? []).map((u) => u.id).join(','),
        (province.queue ?? []).map((q) => `${q.id}:${Math.round(q.progress * 100)}:${Math.round(q.etaSeconds)}`).join(','),
        (province.buildable ?? []).map((b) => `${b.id}${b.affordable ? '+' : '-'}`).join(','),
        (province.construction ?? []).map((q) => `${q.id}:${Math.round(q.progress * 100)}:${Math.round(q.etaSeconds)}`).join(','),
        province.rally ? `${Math.round(province.rally.x)},${Math.round(province.rally.z)}` : '-',
        province.awaitingRallyTarget ? 'arm' : '',
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
        pvProduce.hidden = !(province.isOwn && prod.length > 0);
        if (province.isOwn && prod.length > 0) {
          pvProduceList.replaceChildren(...prod.map((u) => {
            // Portrait-thumb button, RTS build-panel style: the drawing reads
            // first, the cost + role sit on the hover tooltip.
            const b = el('button', 'ifg-buildbtn');
            b.type = 'button';
            const thumb = createUnitPortrait(u.id, u.name);
            thumb.classList.add('ifg-buildbtn__thumb');
            b.append(thumb, el('span', 'ifg-buildbtn__label', u.name));
            b.setAttribute('aria-label', `${u.name} — ${u.costLabel}`);
            bindTooltip(b, () => ({
              title: u.name,
              description: UNIT_ROLE_NOTE[u.id],
              cost: u.costLabel,
            }));
            b.addEventListener('click', () => actions.produceUnit(province.id, u.id));
            return b;
          }));
          const q = province.queue ?? [];
          pvQueue.hidden = q.length === 0;
          if (q.length) {
            renderQueue(pvQueue, q, (id, label) => {
              const thumb = createUnitPortrait(id, label);
              thumb.classList.add('ifg-queue__thumb');
              return thumb;
            });
          }

          // Rally point: where finished units march. Placed by a map click.
          pvRally.hidden = false;
          pvRallyBtn.textContent = province.awaitingRallyTarget
            ? 'Click map…'
            : province.rally ? 'Move rally' : 'Set rally point';
          pvRallyBtn.classList.toggle('is-active', province.awaitingRallyTarget === true);
          pvRallyBtn.onclick = () => actions.rallyPoint(province.id, 'arm');
          pvRallyClear.hidden = !province.rally;
          pvRallyClear.onclick = () => actions.rallyPoint(province.id, 'clear');
        } else {
          pvRally.hidden = true;
        }

        // BUILD panel — offered buildings and anything under construction.
        const buildable = province.buildable ?? [];
        const construction = province.construction ?? [];
        pvBuild.hidden = !province.isOwn || (buildable.length === 0 && construction.length === 0);
        if (!pvBuild.hidden) {
          pvBuildList.replaceChildren(...buildable.map((b) => {
            // Facility icon (0 A.D. art) + short label. Unaffordable buildings
            // stay on the list, disabled, with the cost on the tooltip so the
            // player knows what to save for.
            const btn = el('button', 'ifg-buildbtn');
            btn.type = 'button';
            const icon = FACILITY_ICON[b.id];
            if (icon) btn.append(createIcon(icon, 'ifg-buildbtn__thumb'));
            btn.append(el('span', 'ifg-buildbtn__label', b.name));
            btn.disabled = !b.affordable;
            btn.setAttribute('aria-label', `${b.name} — ${b.costLabel}`);
            bindTooltip(btn, () => ({
              title: b.name,
              description: FACILITY_NOTE[b.id],
              cost: b.costLabel,
              disabledReason: b.affordable ? undefined : `Not enough resources — needs ${b.costLabel}.`,
            }));
            if (b.affordable) {
              btn.addEventListener('click', () => actions.buildStructure(province.id, b.id));
            }
            return btn;
          }));
          pvConstruction.hidden = construction.length === 0;
          if (construction.length) {
            renderQueue(pvConstruction, construction, (id, label) => {
              const icon = FACILITY_ICON[id];
              const thumb = icon ? createIcon(icon, 'ifg-queue__thumb ifg-icon') : el('span', 'ifg-queue__thumb');
              if (!icon) thumb.textContent = label.slice(0, 1);
              return thumb;
            });
          }
        }

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
      army.artillery?.targetArmyId ?? '', army.artillery?.nextVolleyTick ?? 0,
      (army.groups ?? []).map((g) => `${g.typeId}:${g.count}:${Math.round(g.health * 100)}`).join(','),
      (army.battleFronts ?? []).length,
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
