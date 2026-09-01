/**
 * Army / unit UI components: the map counter and the selected-stack readout.
 *
 * These render the fog-aware `ArmyStackView` projection that `main.ts` builds
 * from authoritative GameState (see `game/player-view.ts`) — an unidentified
 * contact shows a '?' counter and a strength-unknown readout. `DEMO_ARMY` is a
 * dev / `?debug` fixture only, gated by the caller.
 */

import { createIcon, iconMarkup, type IconName } from './icons';
import { summarizeBattleFronts } from './army-presentation';
import { bindTooltip } from './tooltip';
import { createUnitPortrait, UNIT_ROLE_NOTE } from './unit-portraits';
import type { ArmyStackView, CombatStatus } from './ui-state';

export type { ArmyStackView, CombatStatus } from './ui-state';

const COMBAT_LABEL: Record<CombatStatus, string> = {
  idle: 'Holding',
  moving: 'On the march',
  engaged: 'In combat',
  retreating: 'Withdrawing',
};

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
  | 'move' | 'attack' | 'retreat' | 'split' | 'stop' | 'extract' | 'deselect'
  | `retreat:${number}`;

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function appendStat(host: HTMLElement, label: string, value: string, icon?: IconName): void {
  const stat = node('span', 'ifg-army-stat');
  stat.title = `${label}: ${value}`;
  const key = node('span', 'ifg-army-stat__key');
  if (icon) key.append(createIcon(icon, 'ifg-army-stat__icon'));
  key.append(node('small', undefined, label));
  stat.append(key, node('b', undefined, value));
  host.append(stat);
}

/** Populate the large centered selected-army command overlay. */
export function renderSelectedArmyPanel(
  host: HTMLElement,
  army: ArmyStackView,
  onCommand: (command: ArmyPanelCommand) => void,
): void {
  host.style.setProperty('--army-country', army.countryColor);
  host.dataset.combat = army.combat;
  host.setAttribute('aria-label', `${army.name}, ${army.country}`);

  const header = node('header', 'ifg-army-panel__header');
  const identity = node('span', 'ifg-army-panel__identity');
  identity.append(node('strong', undefined, army.name), node('small', undefined, army.country));
  const close = node('button', 'ifg-army-panel__close');
  close.type = 'button';
  close.title = 'Deselect army';
  close.setAttribute('aria-label', 'Deselect army');
  close.append(createIcon('close'));
  close.addEventListener('click', () => onCommand('deselect'));
  header.append(node('span', 'ifg-army-panel__header-spacer'), identity, close);

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
    health.append(healthTrack, node('span', 'ifg-army-panel__health-caption', `${healthPercent} / 100 readiness`));
  }

  const commands = node('div', 'ifg-army-panel__commands ifg-army-panel__commands--primary');
  // Icon-first: the glyph carries the meaning, a short caption sits under it, and
  // the full label + explanation live on aria-label + the shared rich tooltip.
  interface CommandTip { description?: string; shortcut?: string; disabledReason?: string; }
  const command = (
    label: string, caption: string, icon: IconName, key: ArmyPanelCommand,
    enabled: boolean, active = false, tip: CommandTip = {},
  ): HTMLButtonElement => {
    const button = node('button', 'ifg-army-panel__command');
    button.type = 'button';
    button.disabled = !enabled;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-label', label);
    button.append(createIcon(icon, 'ifg-army-panel__command-icon'), node('span', 'ifg-army-panel__command-label', caption));
    bindTooltip(button, () => ({
      title: label,
      description: tip.description,
      shortcut: tip.shortcut,
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
      command('Move', moveActive ? 'Pick spot' : 'Move', 'cmd-move', 'move', army.canMove === true, moveActive, {
        description: 'Move this army to a chosen destination in your territory or discovered ground.',
        shortcut: 'M',
        disabledReason: 'This formation is currently locked in combat.',
      }),
      command('Attack', attackActive ? 'Pick target' : 'Attack', 'cmd-attack', 'attack', army.canAttack === true, attackActive, {
        description: 'Advance to contact against a visible hostile force or province.',
        shortcut: 'A',
        disabledReason: 'No visible hostile target in range.',
      }),
      command('Retreat', retreatActive ? 'Pick exit' : 'Retreat', 'cmd-retreat', 'retreat', army.canRetreat === true, retreatActive, {
        description: 'Withdraw along a legal retreat route.',
        shortcut: 'R',
        disabledReason: retreatHint,
      }),
      command('Split', splitActive ? 'Pick spot' : 'Split', 'cmd-split', 'split', army.canSplit === true, splitActive, {
        description: 'Divide this force into two separate formations.',
        shortcut: 'X',
        disabledReason: 'This force is too small to divide.',
      }),
      command('Stop', 'Stop', 'cmd-stop', 'stop', army.canStop === true, false, {
        description: 'Cancel the current movement or order and hold position.',
        shortcut: 'S',
        disabledReason: 'No active order to cancel.',
      }),
      command('Extract', 'Extract', 'cmd-extract', 'extract', army.canExtract === true, false, {
        description: 'Begin resource extraction at the deposit under this stack.',
        shortcut: 'E',
        disabledReason: 'No extractable resource deposit at this position.',
      }),
    );
  }

  const composition = node('section', 'ifg-army-panel__composition');
  composition.append(node('small', 'ifg-army-panel__eyebrow', 'Composition'));
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
  const stats = node('div', 'ifg-army-panel__stats');
  stats.append(node('small', 'ifg-army-panel__eyebrow', 'Troop stats'));
  const statGrid = node('div', 'ifg-army-panel__stat-grid');
  if (army.identified === false) {
    appendStat(statGrid, 'Troops', '--', 'stat-troops');
    appendStat(statGrid, 'Attack', '--', 'stat-attack');
    appendStat(statGrid, 'Defence', '--', 'stat-defence');
    appendStat(statGrid, 'Speed', '--', 'stat-speed');
  } else {
    appendStat(statGrid, 'Troops', String(army.unitCount), 'stat-troops');
    const profile = (value: typeof army.attack): string => value
      ? `${Math.round(value.soft)} / ${Math.round(value.light)} / ${Math.round(value.heavy)}` : '--';
    appendStat(statGrid, 'Attack S/L/H', profile(army.attack), 'stat-attack');
    appendStat(statGrid, 'Defence S/L/H', profile(army.defense), 'stat-defence');
    appendStat(statGrid, 'Speed', army.speed === undefined ? '--' : String(Math.round(army.speed)), 'stat-speed');
  }
  stats.append(statGrid);

  const activity = node('div', 'ifg-army-panel__activity');
  const remaining = (tick: number): string => {
    const seconds = Math.max(0, Math.ceil((tick - (army.simulationTick ?? 0)) / 10));
    return seconds === 0 ? 'Ready' : `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  };
  const battle = army.combat === 'engaged'
    ? summarizeBattleFronts(army.battleFronts, army.simulationTick ?? 0) : null;
  if (battle) {
    activity.classList.add('ifg-army-panel__activity--combat');
    const battleHeader = node('div', 'ifg-battle__header');
    const battleTitle = node('span');
    battleTitle.append(
      node('small', 'ifg-army-panel__eyebrow', 'Combat overview'),
      node('strong', undefined, battle.role === 'mixed'
        ? 'Contested battle' : battle.role === 'attack' ? 'Offensive' : 'Defensive line'),
    );
    battleHeader.append(
      battleTitle,
      node('span', 'ifg-battle__front-count', `${battle.frontCount} ${battle.frontCount === 1 ? 'front' : 'fronts'}`),
    );

    const battleSides = node('div', 'ifg-battle__sides');
    const appendSide = (
      label: string, side: typeof battle.friendly, tone: 'friendly' | 'enemy',
    ): void => {
      const row = node('article', `ifg-battle-side ifg-battle-side--${tone}`);
      const sideHeader = node('div', 'ifg-battle-side__header');
      sideHeader.append(
        node('strong', undefined, label),
        node('b', undefined, `${Math.ceil(side.hp)} / ${Math.ceil(side.baselineHp)} HP`),
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
      const cooldown = node('span', 'ifg-battle-side__cooldown');
      cooldown.classList.toggle('is-ready', side.ready);
      cooldown.append(node('small', undefined, 'Next volley'), node('b', undefined, side.cooldown));
      row.append(sideHeader, healthTrack, cooldown);
      battleSides.append(row);
    };
    appendSide(army.own ? 'Your forces' : 'Selected forces', battle.friendly, army.own ? 'friendly' : 'enemy');
    appendSide(army.own ? 'Enemy forces' : 'Opposing forces', battle.enemy, army.own ? 'enemy' : 'friendly');

    const battleMeta = node('div', 'ifg-battle__meta');
    battleMeta.append(
      node('span', undefined, battle.reinforcementCount
        ? `${battle.reinforcementCount} supporting ${battle.reinforcementCount === 1 ? 'army' : 'armies'}`
        : 'No reinforcements'),
      node('span', undefined, army.legalRetreatExits?.length
        ? `${army.legalRetreatExits.length} retreat ${army.legalRetreatExits.length === 1 ? 'route' : 'routes'} available`
        : 'No safe retreat'),
    );
    activity.append(battleHeader, battleSides, battleMeta);
    // One actionable chip per *distinct* escape direction (the server already
    // collapses the raw per-province routes and tags each with a compass
    // bearing), not one per graph node — that used to spill 25 look-alike
    // buttons into the panel.
    if (army.legalRetreatExits && army.legalRetreatExits.length > 1) {
      const box = node('div', 'ifg-army-panel__retreat');
      box.append(node('small', 'ifg-army-panel__eyebrow', `Retreat routes · ${army.legalRetreatExits.length} open`));
      const exits = node('div', 'ifg-army-panel__retreat-exits');
      for (const [index, exit] of army.legalRetreatExits.entries()) {
        const label = exit.bearing ? `Withdraw ${exit.bearing}` : `Route ${index + 1}`;
        const chip = node('button', 'ifg-army-panel__command ifg-army-panel__retreat-chip');
        chip.type = 'button';
        chip.append(createIcon('cmd-retreat', 'ifg-army-panel__command-icon'), node('span', 'ifg-army-panel__command-label', label));
        chip.setAttribute('aria-label', label);
        chip.title = label;
        chip.addEventListener('click', () => onCommand(`retreat:${exit.firstNodeId}`));
        exits.append(chip);
      }
      box.append(exits);
      activity.append(box);
    }
  } else {
    activity.append(node('small', 'ifg-army-panel__eyebrow', 'Activity'));
    const activityValue = node('strong', 'ifg-army-panel__activity-value', army.activity);
    activityValue.dataset.combat = army.combat;
    activity.append(activityValue);
    if (army.artillery?.targetArmyId) {
      activity.append(node('span', undefined,
        `${army.artillery.manualTarget ? 'Selected' : 'Automatic'} bombardment: ${army.artillery.targetArmyId} · ${remaining(army.artillery.nextVolleyTick)}`));
    }
  }
  report.append(stats, activity);

  const body = node('div', 'ifg-army-panel__body');
  const center = node('div', 'ifg-army-panel__center');
  center.append(commands, composition);
  body.append(health, center, report);
  host.replaceChildren(header, body);
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
