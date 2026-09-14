/**
 * Army / unit UI components: the map counter and the selected-stack readout.
 *
 * These render the fog-aware `ArmyStackView` projection that `main.ts` builds
 * from authoritative GameState (see `game/player-view.ts`) — an unidentified
 * contact shows a '?' counter and a strength-unknown readout. `DEMO_ARMY` is a
 * authenticated-debug fixture only, gated by the caller.
 */

import { createIcon, iconMarkup, type IconName } from './icons';
import { roundDisplayedHp, summarizeBattleFronts, type BattleSidePresentation } from './army-presentation';
import { bindTooltip } from './tooltip';
import { createUnitPortrait, UNIT_ROLE_NOTE } from './unit-portraits';
import type { ArmyActivityKind, ArmyStackView, CombatStatus } from './ui-state';

export type { ArmyStackView, CombatStatus } from './ui-state';

const COMBAT_LABEL: Record<CombatStatus, string> = {
  idle: 'Holding',
  moving: 'On the march',
  engaged: 'In combat',
  retreating: 'Withdrawing',
};

function formatDamageRate(value: number): string {
  if (!Number.isFinite(value)) return '--';
  // Absolute damage-per-hour dealt to a target stack (see COMBAT_DAMAGE_SCALE
  // in game/combat/constants.ts) — not a 0..1 fraction, so no percentage sign.
  if (value <= 0) return '0';
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

function formatGameDuration(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return 'indeterminate';
  return hours < 10 ? `${hours.toFixed(1)} game h` : `${Math.round(hours)} game h`;
}

function formatRealDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'indeterminate real time';
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} sec real`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)} min real`;
  const hours = seconds / 3_600;
  return `${hours < 10 ? hours.toFixed(1) : Math.round(hours)} hr real`;
}

/**
 * Compact map counter for a stacked force. Original Ironfronts styling: a
 * stamped brass-cornered charcoal chit, not a NATO symbol. Purely presentational
 * — positioning on the map is the caller's job once armies have world coords.
 */
export function createArmyCounter(army: ArmyStackView): HTMLElement {
  const el = document.createElement('div');
  el.className = 'ifg-counter';
  el.dataset.combat = army.combat;
  el.classList.toggle('is-selected', army.selected);
  el.style.setProperty('--counter-country', army.countryColor);
  el.setAttribute('role', 'img');
  const unidentified = army.identified === false;
  el.classList.toggle('is-unidentified', unidentified);
  el.setAttribute('aria-label', unidentified
    ? `Unidentified ${army.country} force — strength unknown`
    : `${army.name}: ${army.unitCount} units, ${Math.round(army.strength * 100)}% strength, ${COMBAT_LABEL[army.combat]}`);
  el.innerHTML = `
    <span class="ifg-counter__corner ifg-counter__corner--tl"></span>
    <span class="ifg-counter__corner ifg-counter__corner--br"></span>
    <b class="ifg-counter__count">${unidentified ? '?' : army.unitCount}</b>
    ${iconMarkup('note-combat', 'ifg-counter__glyph')}
    <span class="ifg-counter__bar"><i style="width:${unidentified ? 0 : Math.round(army.health * 100)}%"></i></span>
  `;
  return el;
}

/** Detailed selected-stack readout for the contextual panel. */
export function describeArmy(army: ArmyStackView): Array<[string, string]> {
  if (army.identified === false) {
    // Contact only: we know where it is and whose it is, nothing more.
    return [
      ['Force', 'Unidentified'],
      ['Command', army.country],
      ['Intel', 'Position only — strength unknown'],
    ];
  }
  return [
    ['Force', army.name],
    ['Command', army.country],
    ['Divisions', String(army.unitCount)],
    ['Strength', `${Math.round(army.strength * 100)}%`],
    ['Readiness', `${Math.round(army.health * 100)}%`],
    ['Status', COMBAT_LABEL[army.combat]],
  ];
}

export type ArmyPanelCommand =
  | 'move' | 'attack' | 'retreat' | 'split' | 'stop' | 'extract-food' | 'extract-stone' | 'extract-metal' | 'extract-oil' | 'deselect'
  | 'stance-attack' | 'stance-attack-defend' | 'stance-defend' | 'stance-defend-retreat' | 'stance-retreat';

const STANCE_OPTIONS: ReadonlyArray<{ command: ArmyPanelCommand; icon: IconName; label: string; description: string }> = [
  { command: 'stance-attack', icon: 'stance-attack', label: 'Attack', description: 'Hits harder; never digs in; holds the assault until organization nearly breaks.' },
  { command: 'stance-attack-defend', icon: 'stance-attack-defend', label: 'Balanced', description: 'No bonus or penalty either way — the default posture.' },
  { command: 'stance-defend', icon: 'stance-defend', label: 'Defend', description: 'Takes less damage and digs in fast; holds the line at all costs.' },
  { command: 'stance-defend-retreat', icon: 'stance-defend-retreat', label: 'Defensive', description: 'Some defensive bonus, but pulls back early to preserve the force.' },
  { command: 'stance-retreat', icon: 'stance-retreat', label: 'Cautious', description: 'No combat bonus; breaks off at the first real pressure.' },
];
const SUPPLY_RESOURCES = [
  { id: 'funds', label: 'Funds', color: '#d1b56a' },
  { id: 'food', label: 'Food', color: '#d6a24f' },
  { id: 'metal', label: 'Metal', color: '#91a0a5' },
  { id: 'oil', label: 'Oil', color: '#6d9b8d' },
] as const;

const ACTIVITY_ICON: Record<ArmyActivityKind, IconName> = {
  holding: 'cmd-stop', moving: 'cmd-move', embarking: 'activity-embark',
  atSea: 'activity-embark', disembarking: 'activity-disembark', combat: 'note-combat',
  retreating: 'cmd-retreat', extracting: 'cmd-extract',
};

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function formatActivityDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--:--';
  const total = Math.max(0, Math.ceil(seconds));
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor(total % 3_600 / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Keep the compact operational clock live without rebuilding portrait cards. */
function startActivityClock(
  host: HTMLElement, time: HTMLElement, fills: readonly HTMLElement[],
  remainingSeconds: number | undefined, durationSeconds: number | undefined,
  initialProgress: number, sampledAtEpochMs: number,
): void {
  if (remainingSeconds === undefined) return;
  let timer = 0;
  const update = (): void => {
    if (!host.isConnected || host.closest('[hidden]')) { window.clearInterval(timer); return; }
    const elapsed = Math.max(0, (Date.now() - sampledAtEpochMs) / 1_000);
    const remaining = Math.max(0, remainingSeconds - elapsed);
    time.textContent = formatActivityDuration(remaining);
    if (durationSeconds && durationSeconds > 0) {
      const width = `${Math.min(100, Math.max(0, (initialProgress + elapsed / durationSeconds) * 100))}%`;
      for (const fill of fills) fill.style.width = width;
    }
    if (remaining <= 0) window.clearInterval(timer);
  };
  timer = window.setInterval(update, 1_000);
  update();
}

/** Populate the large centered selected-army command overlay. */
export function renderSelectedArmyPanel(
  host: HTMLElement,
  army: ArmyStackView,
  onCommand: (command: ArmyPanelCommand) => void,
): void {
  host.style.setProperty('--army-country', army.countryColor);
  host.dataset.combat = army.combat;
  const header = node('header', 'ifg-army-panel__header');
  const identity = node('span', 'ifg-army-panel__identity');
  identity.append(node('strong', undefined, army.name), node('small', undefined, army.country));
  const battle = army.combat === 'engaged' ? summarizeBattleFronts(army.battleFronts) : null;
  const activityKind = army.activityKind ?? (army.combat === 'engaged' ? 'combat'
    : army.combat === 'retreating' ? 'retreating' : army.combat === 'moving' ? 'moving' : 'holding');
  const headerActivity = node('section', `ifg-army-panel__header-activity is-${activityKind}`);
  headerActivity.append(createIcon(ACTIVITY_ICON[activityKind], 'ifg-army-panel__activity-icon'));
  const operation = node('span', 'ifg-army-panel__operation');
  operation.append(node('small', undefined, 'Activity'), node('strong', undefined, army.activity));
  const operationTrack = node('span', 'ifg-army-panel__operation-track');
  const operationFill = node('i');
  const initialActivityProgress = Math.min(1, Math.max(0, army.activityProgress ?? 0));
  operationFill.style.width = `${initialActivityProgress * 100}%`;
  operationTrack.append(operationFill);
  operation.append(operationTrack);
  const liveFills = [operationFill];
  if (activityKind === 'embarking' || activityKind === 'disembarking') {
    const navalTrack = node('span', 'ifg-army-panel__naval-track');
    const navalFill = node('i');
    navalFill.style.width = `${initialActivityProgress * 100}%`;
    navalTrack.append(navalFill);
    operation.append(navalTrack);
    liveFills.push(navalFill);
  }
  const activityTime = node('time', 'ifg-army-panel__activity-time',
    formatActivityDuration(army.activityRemainingSeconds ?? Number.NaN));
  headerActivity.append(operation, activityTime);
  bindTooltip(headerActivity, () => ({
    title: army.activity,
    description: activityKind === 'combat'
      ? 'Predicted time until the first active front resolves.'
      : activityKind === 'embarking' || activityKind === 'disembarking'
        ? 'Port handling takes 30 game minutes; the blue line tracks this phase.'
        : 'Authoritative time remaining on the current movement leg.',
  }));
  const headerMetric = (label: string, icon: IconName, value: string): HTMLElement => {
    const item = node('span');
    item.append(createIcon(icon, 'ifg-army-stat__icon'), node('small', undefined, label), node('b', undefined, value));
    return item;
  };
  const compositionStats = node('span', 'ifg-army-panel__header-stats');
  compositionStats.append(
    headerMetric('Speed', 'stat-speed', army.identified === false || army.speed === undefined ? '--' : String(Math.round(army.speed))),
    headerMetric('Troops', 'stat-troops', army.identified === false ? '--' : String(army.unitCount)),
  );
  const close = node('button', 'ifg-army-panel__close');
  close.type = 'button';
  close.title = 'Deselect army';
  close.setAttribute('aria-label', 'Deselect army');
  close.append(createIcon('close'));
  close.addEventListener('click', () => onCommand('deselect'));
  const health = node('section', 'ifg-army-panel__health');
  const healthEyebrow = node('small', 'ifg-army-panel__eyebrow');
  healthEyebrow.append(createIcon('stat-health', 'ifg-army-panel__eyebrow-icon'), document.createTextNode('Health'));
  health.append(healthEyebrow);
  if (army.identified === false) {
    health.append(node('b', 'ifg-army-panel__health-value', '--'), node('span', 'ifg-army-panel__unknown', 'Unknown strength'));
  } else {
    const healthPercent = Math.round(army.health * 100);
    health.append(node('b', 'ifg-army-panel__health-value', `${healthPercent}%`));
    const healthTrack = node('span', 'ifg-army-panel__health-track');
    const healthFill = node('i', 'ifg-army-panel__health-fill');
    healthFill.style.width = `${healthPercent}%`;
    healthTrack.append(healthFill);
    // Organization is a real, separate stat from health (see
    // game/combat/organization.ts) — a battered-but-intact stack can still be
    // forced to retreat once this collapses. Entrenchment only shows once it's
    // actually built up, so a freshly-arrived stack's caption stays uncluttered.
    const orgPercent = Math.round((army.organization ?? army.health) * 100);
    const entrenchPercent = Math.round((army.entrenchment ?? 0) * 100);
    const captionParts = [`${orgPercent} / 100 organization`];
    if (entrenchPercent > 0) captionParts.push(`${entrenchPercent}% entrenched`);
    if (army.own && army.inSupply === false) captionParts.push('out of supply');
    const captionEl = node('span', 'ifg-army-panel__health-caption', captionParts.join(' · '));
    if (army.own && army.inSupply === false) captionEl.classList.add('is-warning');
    health.append(healthTrack, captionEl);
  }

  const stats = node('section', 'ifg-army-panel__stats');
  stats.append(node('small', 'ifg-army-panel__eyebrow', 'Combat profile'));
  const statTable = node('table', 'ifg-army-panel__stat-table');
  const statHead = node('thead');
  const headingRow = node('tr');
  const statHeading = (label: string, icon: IconName, description: string): HTMLElement => {
    const heading = node('th');
    heading.append(createIcon(icon, 'ifg-army-stat__icon'));
    bindTooltip(heading, () => ({ title: label, description }));
    return heading;
  };
  headingRow.append(
    statHeading('Base damage per game hour', 'stat-attack', 'Total damage output against the target per game hour.'),
    statHeading('Soft damage', 'marker-infantry', 'Damage applied to soft targets.'),
    statHeading('Light damage', 'marker-light-tank', 'Damage applied to light armor.'),
    statHeading('Heavy damage', 'marker-medium-tank', 'Damage applied to heavy armor.'),
  );
  statHead.append(headingRow);
  const statBody = node('tbody');
  const appendProfile = (label: string, icon: IconName, value: typeof army.attack): void => {
    const row = node('tr');
    const key = node('th');
    key.append(createIcon(icon, 'ifg-army-stat__icon'), document.createTextNode(label));
    row.append(
      key,
      node('td', undefined, value ? formatDamageRate(value.soft) : '--'),
      node('td', undefined, value ? formatDamageRate(value.light) : '--'),
      node('td', undefined, value ? formatDamageRate(value.heavy) : '--'),
    );
    statBody.append(row);
  };
  appendProfile('Attack', 'stat-attack', army.identified === false ? undefined : army.attack);
  appendProfile('Defence', 'stat-defence', army.identified === false ? undefined : army.defense);
  statTable.append(statHead, statBody);
  stats.append(statTable);
  const headerStances = node('div', 'ifg-army-panel__stances');
  headerStances.setAttribute('role', 'group');
  headerStances.setAttribute('aria-label', 'Combat stance');
  if (army.own) {
    for (const option of STANCE_OPTIONS) {
      const btn = node('button', 'ifg-army-panel__stance');
      btn.type = 'button';
      const active = (army.stance ?? 'attack-defend') === option.command.slice('stance-'.length);
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-label', option.label);
      btn.append(createIcon(option.icon, 'ifg-army-panel__stance-icon'));
      bindTooltip(btn, () => ({ title: option.label, description: option.description }));
      btn.addEventListener('click', () => onCommand(option.command));
      headerStances.append(btn);
    }
  }
  const headerControls = node('span', 'ifg-army-panel__header-controls');
  if (army.supply) {
    const supplyBar = node('span', 'ifg-army-panel__supply-bar');
    supplyBar.setAttribute('role', 'img');
    supplyBar.setAttribute('aria-label', army.supply.connected ? 'Supply connected' : 'Supply stores');
    const children = SUPPLY_RESOURCES.filter((resource) => (army.supply!.allocation[resource.id] ?? 0) > 0).map((resource) => {
      const maximum = army.supply!.allocation[resource.id] ?? 0;
      const current = Math.max(0, army.supply!.stores[resource.id] ?? 0);
      const segment = node('i', 'ifg-army-panel__supply-segment');
      segment.style.width = `${army.supply!.capacity > 0 ? current / army.supply!.capacity * 100 : 0}%`;
      segment.style.backgroundColor = resource.color;
      supplyBar.append(segment);
      const depleted = current <= 0;
      const debuff = depleted
        ? 'Store empty: this resource’s unit-specific shortages are active.'
        : army.shortage?.modifiers && Object.values(army.shortage.modifiers).some((value) => value < 0.999)
          ? 'A shortage effect is active on this army.' : 'No shortage effect active.';
      return { label: resource.label, value: `${Math.round(current)} / ${Math.round(maximum)}`, content: {
        title: resource.label, description: debuff, status: army.supply!.connected ? 'Connected' : 'Depleting',
      } };
    });
    const activeDebuffs = Object.entries(army.shortage?.modifiers ?? {}).filter(([, value]) => value < 0.999);
    bindTooltip(supplyBar, () => ({
      title: 'Supply stores',
      description: army.supply!.connected ? 'Connected to the capital or a nearby ocean route.' : 'Disconnected: stores are being consumed.',
      children: [
        ...children,
        ...(activeDebuffs.length ? [{ label: 'Active debuffs', value: `${activeDebuffs.length}`, content: {
          title: 'Active shortage effects',
          children: activeDebuffs.map(([stat, value]) => ({ label: stat.replace(/([A-Z])/g, ' $1'), value: `${Math.round(value * 100)}%` })),
        } }] : []),
      ],
    }));
    const supplyDisplay = node('span', 'ifg-army-panel__supply-display');
    supplyDisplay.append(createIcon('supply', 'ifg-army-panel__supply-icon'), supplyBar);
    headerControls.append(supplyDisplay);
  }
  headerControls.append(headerStances);
  header.append(headerActivity, identity, headerControls, close);
  const summary = node('div', 'ifg-army-panel__summary');
  summary.append(health, stats);

  const commands = node('div', 'ifg-army-panel__commands ifg-army-panel__commands--primary');
  // Text-free order tiles: the pictogram carries the meaning while the full
  // label and explanation remain available to assistive tech and on hover/focus.
  interface CommandTip { description?: string; disabledReason?: string; }
  const command = (
    label: string, icon: IconName, key: ArmyPanelCommand,
    enabled: boolean, active = false, tip: CommandTip = {},
  ): HTMLButtonElement => {
    const button = node('button', 'ifg-army-panel__command');
    button.type = 'button';
    button.disabled = !enabled;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-label', label);
    button.append(createIcon(icon, 'ifg-army-panel__command-icon'));
    bindTooltip(button, () => ({
      title: label,
      description: tip.description,
      disabledReason: enabled ? undefined : (tip.disabledReason ?? `${label} is unavailable right now.`),
    }));
    if (enabled) button.addEventListener('click', () => onCommand(key));
    return button;
  };
  if (army.own) {
    // Why Retreat is unavailable, so the player understands it before clicking.
    const retreatHint = army.combat === 'engaged'
      ? (army.legalRetreatExits?.length
        ? 'Break contact and withdraw along a friendly road.'
        : 'No open line of retreat — the stack is encircled.')
      : army.combat === 'retreating'
        ? 'The stack is already withdrawing.'
        : 'Retreat opens once the stack is locked in close combat.';
    const moveActive = army.targetingMode === 'move';
    const attackActive = army.targetingMode === 'attack';
    const retreatActive = army.targetingMode === 'retreat';
    const splitActive = army.targetingMode === 'split';
    commands.append(
      command('Move', 'cmd-move', 'move', army.canMove === true, moveActive, {
        description: 'Move this army to a chosen destination in your territory or discovered ground.',
        disabledReason: army.moveDisabledReason,
      }),
      command('Attack', 'cmd-attack', 'attack', army.canAttack === true, attackActive, {
        description: 'Advance to contact against a visible hostile force or province.',
        disabledReason: 'No visible hostile target in range.',
      }),
      command('Retreat', 'cmd-retreat', 'retreat', army.canRetreat === true, retreatActive, {
        description: 'Choose a friendly destination away from the enemy line.',
        disabledReason: retreatHint,
      }),
      command('Split', 'cmd-split', 'split', army.canSplit === true, splitActive, {
        description: 'Divide this force into two separate formations.',
        disabledReason: 'This force is too small to divide.',
      }),
      command('Stop', 'cmd-stop', 'stop', army.canStop === true, false, {
        description: 'Cancel the current movement or order and hold position.',
        disabledReason: 'No active order to cancel.',
      }),
    );
    for (const resource of army.extractableResources ?? []) commands.append(command(
      `Amplify ${resource}`, 'cmd-extract', `extract-${resource}` as ArmyPanelCommand, army.canExtract === true, false,
      {
        description: `Assign this army's engineers to continuous ${resource} production at the province center.`,
        disabledReason: 'No extractable resource deposit at this position.',
      },
    ));
  }

  const composition = node('section', 'ifg-army-panel__composition');
  const compositionHeader = node('header', 'ifg-army-panel__composition-header');
  compositionHeader.append(node('small', 'ifg-army-panel__eyebrow', 'Composition'), compositionStats);
  composition.append(compositionHeader);
  const unitRow = node('div', 'ifg-army-panel__units');
  if (army.identified === false || !army.groups?.length) {
    unitRow.append(node('span', 'ifg-army-panel__intel', 'Composition unavailable'));
  } else {
    // Portrait-card strip — the drawing carries the identity, the name is
    // secondary, and the numbers / role move onto the hover tooltip. Tightens
    // to a denser grid once the stack fields more than four unit families.
    unitRow.classList.toggle('is-dense', army.groups.length > 4);
    for (const group of army.groups) {
      const health = Math.round(group.health * 100);
      const unit = node('article', 'ifg-army-unit');
      unit.dataset.unitType = group.typeId;
      const visual = node('span', 'ifg-army-unit__visual');
      visual.append(createUnitPortrait(group.typeId, group.label));
      visual.append(node('b', 'ifg-army-unit__count', `×${group.count}`));
      const details = node('span', 'ifg-army-unit__details');
      details.append(node('strong', undefined, group.label));
      const condition = node('span', 'ifg-army-unit__condition');
      condition.dataset.state = health >= 66 ? 'ok' : health >= 33 ? 'worn' : 'spent';
      const conditionFill = node('i');
      conditionFill.style.width = `${health}%`;
      condition.append(conditionFill);
      unit.append(visual, details, condition);
      bindTooltip(unit, () => ({
        title: group.label,
        description: UNIT_ROLE_NOTE[group.typeId],
        status: `${group.count} strong · ${health}% condition`,
      }));
      unitRow.append(unit);
    }
  }
  composition.append(unitRow);

  const report = node('section', 'ifg-army-panel__report');

  const activity = node('div', 'ifg-army-panel__activity');
  {
    activity.classList.add('ifg-army-panel__activity--combat');
    const battleHeader = node('div', `ifg-battle__header${battle ? '' : ' is-inactive'}`);
    const battleTitle = node('span');
    battleTitle.append(
      node('small', 'ifg-army-panel__eyebrow', battle ? 'Combat overview' : 'Battle readiness'),
      node('strong', undefined, battle
        ? battle.role === 'mixed' ? 'Contested battle' : battle.role === 'attack' ? 'Offensive' : 'Defensive line'
        : 'Not engaged'),
    );
    battleHeader.append(
      battleTitle,
      node('span', 'ifg-battle__front-count', battle ? `${battle.frontCount} ${battle.frontCount === 1 ? 'front' : 'fronts'}` : 'No active front'),
    );

    const battleSides = node('div', 'ifg-battle__sides');
      const appendSide = (
        label: string, side: BattleSidePresentation, tone: 'friendly' | 'enemy',
    ): void => {
      const row = node('article', `ifg-battle-side ifg-battle-side--${tone}${battle ? '' : ' is-inactive'}`);
      const sideHeader = node('div', 'ifg-battle-side__header');
      sideHeader.append(
        node('strong', undefined, label),
        node('b', undefined, `${roundDisplayedHp(side.hp)} / ${roundDisplayedHp(side.baselineHp)} HP · ${battle ? side.organizationPercent : '--'}% org`),
      );
      const healthTrack = node('span', 'ifg-battle-side__health');
      healthTrack.setAttribute('role', 'progressbar');
      healthTrack.setAttribute('aria-label', `${label} health`);
      healthTrack.setAttribute('aria-valuemin', '0');
      healthTrack.setAttribute('aria-valuemax', '100');
      healthTrack.setAttribute('aria-valuenow', String(side.healthPercent));
      const healthFill = node('i');
      healthFill.style.width = `${side.healthPercent}%`;
      healthTrack.append(healthFill);
      row.append(sideHeader, healthTrack);
      battleSides.append(row);
    };
    const friendlySide = battle?.friendly ?? {
      hp: army.identified === false ? 0 : army.health,
      baselineHp: army.identified === false ? 0 : 1,
      healthPercent: army.identified === false ? 0 : Math.round(army.health * 100),
      organizationPercent: army.identified === false ? 0 : Math.round((army.organization ?? 0) * 100),
      damagePerGameHour: 0,
    };
    const enemySide = battle?.enemy ?? { hp: 0, baselineHp: 0, healthPercent: 0, organizationPercent: 0, damagePerGameHour: 0 };
    appendSide(army.own ? 'Your forces' : 'Selected forces', friendlySide, army.own ? 'friendly' : 'enemy');
    appendSide(army.own ? 'Enemy forces' : 'Opposing forces', enemySide, army.own ? 'enemy' : 'friendly');

    activity.append(battleHeader, battleSides);
    // Damage rates, modifiers, and reinforcement/retreat counts only mean
    // anything once a front actually exists — showing them as "--" placeholders
    // while idle was just clutter (and at the small size they need to stay
    // legible, they don't have room for a "no data" long-form fallback).
    if (battle) {
      const battleLive = node('div', 'ifg-battle__live');
      battleLive.append(
        node('span', undefined, `Outgoing ${formatDamageRate(battle.outgoingDamagePerGameHour)} HP / game h`),
        node('span', undefined, `Incoming ${formatDamageRate(battle.incomingDamagePerGameHour)} HP / game h`),
        node('span', undefined, `Losses ${roundDisplayedHp(battle.friendlyCasualties)} friendly / ${roundDisplayedHp(battle.enemyCasualties)} enemy HP`),
        node('span', undefined, `Estimated ${formatGameDuration(battle.estimatedGameHours)} · ${formatRealDuration(battle.estimatedRealSeconds)}`),
      );
      const battleModifiers = node('div', 'ifg-battle__modifiers', battle.modifiers.join(' · '));
      const battleMeta = node('div', 'ifg-battle__meta');
      battleMeta.append(
        node('span', undefined, battle.reinforcementCount
          ? `${battle.reinforcementCount} supporting ${battle.reinforcementCount === 1 ? 'army' : 'armies'}`
          : 'No reinforcements'),
        node('span', undefined, army.legalRetreatExits?.length
          ? `${army.legalRetreatExits.length} retreat ${army.legalRetreatExits.length === 1 ? 'route' : 'routes'} available`
          : 'No safe retreat'),
      );
      activity.append(battleLive, battleModifiers, battleMeta);
    }
  }
  if (army.artillery?.targetArmyId) {
    activity.append(node('span', undefined,
      `${army.artillery.manualTarget ? 'Selected' : 'Automatic'} continuous bombardment: ${army.artillery.targetArmyId}`));
  }
  report.append(activity);

  const body = node('div', 'ifg-army-panel__body');
  const center = node('div', 'ifg-army-panel__center');
  center.append(composition);
  body.append(summary, center, report);
  host.replaceChildren(commands, header, body);
  startActivityClock(headerActivity, activityTime, liveFills, army.activityRemainingSeconds,
    army.activityDurationSeconds, initialActivityProgress, army.activitySampledAtEpochMs ?? Date.now());
}

/**
 * SVG marker for a movement / attack order arrow. Styling only — it encodes no
 * game rules and is not placed until a movement system supplies path points.
 */
export function createOrderArrow(kind: 'move' | 'attack'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `ifg-order-arrow ifg-order-arrow--${kind}`);
  svg.setAttribute('viewBox', '0 0 100 24');
  svg.innerHTML = `
    <defs>
      <marker id="ifg-arrowhead-${kind}" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
        <path d="M0,0 L7,3.5 L0,7 Z" />
      </marker>
    </defs>
    <line x1="4" y1="12" x2="86" y2="12" marker-end="url(#ifg-arrowhead-${kind})" />
  `;
  return svg;
}

/** Dev-only demonstration stack for screenshots / component tests. */
export const DEMO_ARMY: ArmyStackView = {
  id: 'demo-1',
  country: 'France',
  countryColor: '#3f6cae',
  name: '1re Armée',
  unitCount: 12,
  strength: 0.82,
  health: 0.67,
  selected: true,
  combat: 'idle',
  activity: 'Holding position',
  moveOrder: null,
  speed: 90,
  attack: { soft: 52, light: 31, heavy: 19 },
  defense: { soft: 44, light: 26, heavy: 14 },
  own: true,
  canExtract: true,
  groups: [
    { typeId: 'infantry', label: 'Infantry', count: 8, health: 0.72 },
    { typeId: 'armored-car', label: 'Armored Car', count: 2, health: 0.61 },
    { typeId: 'artillery', label: 'Artillery', count: 2, health: 0.7 },
  ],
};
