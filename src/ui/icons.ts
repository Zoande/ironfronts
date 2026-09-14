/**
 * HUD icon registry.
 *
 * Three tiers, on purpose:
 *  - painterly resource / action icons from 0 A.D. (CC BY-SA 3.0, see
 *    docs/ASSET_CREDITS.md) rendered as <img>;
 *  - flat monochrome line icons authored for Ironfronts, inlined as SVG so
 *    they inherit `currentColor` for hover / active states;
 *  - grounded WW2 portrait art for unit, building, and command buttons,
 *    rendered as transparent PNGs.
 *
 * No Unicode / emoji glyphs anywhere in the player HUD.
 */

import infantryTechUrl from './assets/units/infantry.png?url';

const pngUrls = import.meta.glob('./assets/icons/0ad/**/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

const svgRaw = import.meta.glob('./assets/icons/ironfronts/*.svg', {
  eager: true, query: '?raw', import: 'default',
}) as Record<string, string>;

// User-provided Ironfronts raster icons (see docs/ASSET_CREDITS.md).
const ironfrontsPngUrls = import.meta.glob('./assets/icons/ironfronts/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

/** 0 A.D. icon by stem, or `sub/stem` for the stances/ranks/formations subdirs. */
const png = (name: string): string => pngUrls[`./assets/icons/0ad/${name}.png`];
const svg = (name: string): string => svgRaw[`./assets/icons/ironfronts/${name}.svg`];
const ironfrontsPng = (name: string): string => ironfrontsPngUrls[`./assets/icons/ironfronts/${name}.png`];

export type IconName =
  | 'funds' | 'manpower' | 'food' | 'metal' | 'oil' | 'industry'
  | 'mode-strategic' | 'mode-political' | 'mode-diplomacy' | 'mode-terrain'
  | 'diplomacy' | 'economy' | 'objectives' | 'events' | 'provinces' | 'trade'
  | 'resource-overlay' | 'close' | 'focus' | 'expand' | 'system' | 'rally'
  | 'weather-clear' | 'weather-rain'
  | 'note-warning' | 'note-combat' | 'note-completed' | 'note-diplomacy' | 'note-information'
  | 'node-stone' | 'node-metal' | 'node-oil' | 'resource-water'
  | 'cmd-move' | 'cmd-attack' | 'cmd-retreat' | 'cmd-split' | 'cmd-stop' | 'cmd-extract'
  | 'cmd-patrol' | 'cmd-garrison'
  | 'unit-engineer' | 'unit-infantry' | 'unit-armored-car' | 'unit-light-tank' | 'unit-medium-tank'
  | 'marker-infantry' | 'marker-engineer' | 'marker-armored-car'
  | 'marker-light-tank' | 'marker-medium-tank' | 'marker-artillery'
  | 'tech-militia' | 'tech-commandos'
  | 'stat-health' | 'stat-attack' | 'stat-defence' | 'stat-speed' | 'stat-troops' | 'supply'
  | 'activity-embark' | 'activity-disembark'
  | 'structure-barracks' | 'structure-plant' | 'structure-ordnance' | 'structure-missile'
  | 'building-fields' | 'building-quarry' | 'building-mine' | 'building-oil-pump'
  | 'structure-fortress' | 'structure-city'
  | 'stance-attack' | 'stance-attack-defend' | 'stance-defend'
  | 'stance-retreat' | 'stance-defend-retreat'
  | 'note-attacked' | 'rank-basic' | 'rank-advanced' | 'rank-elite';

interface IconDef { readonly kind: 'img' | 'svg'; readonly value: string; }

const ICONS: Record<IconName, IconDef> = {
  funds: { kind: 'img', value: png('economics') },
  manpower: { kind: 'img', value: png('population') },
  food: { kind: 'img', value: png('food') },
  metal: { kind: 'img', value: png('metal') },
  oil: { kind: 'svg', value: svg('oil') },
  industry: { kind: 'img', value: png('production') },
  'mode-strategic': { kind: 'svg', value: svg('strategic') },
  'mode-political': { kind: 'svg', value: svg('political') },
  'mode-diplomacy': { kind: 'img', value: png('diplomacy') },
  'mode-terrain': { kind: 'svg', value: svg('terrain') },
  diplomacy: { kind: 'img', value: png('diplomacy') },
  economy: { kind: 'img', value: png('economics') },
  objectives: { kind: 'img', value: png('objectives') },
  events: { kind: 'svg', value: svg('event') },
  provinces: { kind: 'svg', value: svg('provinces') },
  trade: { kind: 'svg', value: svg('trade') },
  rally: { kind: 'img', value: png('focus-rally') },
  'resource-overlay': { kind: 'svg', value: svg('pickaxe') },
  close: { kind: 'svg', value: svg('close') },
  focus: { kind: 'svg', value: svg('focus') },
  expand: { kind: 'svg', value: svg('expand') },
  system: { kind: 'svg', value: svg('system') },
  'weather-clear': { kind: 'svg', value: svg('clear-sky') },
  'weather-rain': { kind: 'svg', value: svg('rain') },
  'note-warning': { kind: 'svg', value: svg('warning') },
  'note-combat': { kind: 'img', value: png('attack-request') },
  'note-attacked': { kind: 'img', value: png('focus-attacked') },
  'note-completed': { kind: 'svg', value: svg('check') },
  'note-diplomacy': { kind: 'img', value: png('diplomacy') },
  'note-information': { kind: 'svg', value: svg('info') },
  'node-stone': { kind: 'img', value: png('stone') },
  'node-metal': { kind: 'img', value: png('metal') },
  'node-oil': { kind: 'svg', value: svg('oil') },
  'resource-water': { kind: 'img', value: ironfrontsPng('water') },
  // The six live orders share one restrained, hand-painted WW2 family.
  'cmd-move': { kind: 'img', value: ironfrontsPng('command-move') },
  'cmd-attack': { kind: 'img', value: ironfrontsPng('command-attack') },
  'cmd-retreat': { kind: 'img', value: ironfrontsPng('command-retreat') },
  'cmd-split': { kind: 'img', value: ironfrontsPng('command-split') },
  'cmd-stop': { kind: 'img', value: ironfrontsPng('command-stop') },
  'cmd-extract': { kind: 'img', value: ironfrontsPng('command-extract') },
  'cmd-patrol': { kind: 'img', value: png('patrol') },
  'cmd-garrison': { kind: 'img', value: png('garrison') },
  'unit-engineer': { kind: 'img', value: ironfrontsPng('unit-engineer-icon') },
  'unit-infantry': { kind: 'img', value: infantryTechUrl },
  'unit-armored-car': { kind: 'img', value: ironfrontsPng('unit-armored-car-icon') },
  'unit-light-tank': { kind: 'img', value: ironfrontsPng('unit-light-tank-icon') },
  'unit-medium-tank': { kind: 'img', value: ironfrontsPng('unit-medium-tank-icon') },
  'marker-infantry': { kind: 'img', value: ironfrontsPng('marker-infantry') },
  'marker-engineer': { kind: 'img', value: ironfrontsPng('marker-engineer') },
  'marker-armored-car': { kind: 'img', value: ironfrontsPng('marker-armored-car') },
  'marker-light-tank': { kind: 'img', value: ironfrontsPng('marker-light-tank') },
  'marker-medium-tank': { kind: 'img', value: ironfrontsPng('marker-medium-tank') },
  'marker-artillery': { kind: 'img', value: ironfrontsPng('marker-artillery') },
  'tech-militia': { kind: 'svg', value: svg('tech-militia') },
  'tech-commandos': { kind: 'svg', value: svg('tech-commandos') },
  'stat-health': { kind: 'img', value: png('heal') },
  'stat-attack': { kind: 'svg', value: svg('crossed-blades') },
  'stat-defence': { kind: 'svg', value: svg('shield') },
  'stat-speed': { kind: 'svg', value: svg('speed') },
  'stat-troops': { kind: 'svg', value: svg('troops') },
  supply: { kind: 'svg', value: svg('supply') },
  'activity-embark': { kind: 'svg', value: svg('activity-embark') },
  'activity-disembark': { kind: 'svg', value: svg('activity-disembark') },
  'structure-barracks': { kind: 'img', value: ironfrontsPng('structure-barracks-icon') },
  'structure-plant': { kind: 'img', value: ironfrontsPng('structure-tank-plant-icon') },
  'structure-ordnance': { kind: 'img', value: ironfrontsPng('structure-ordnance-icon') },
  // Separate catalogue keys deliberately share shipped art for now. Keeping
  // them distinct lets each structure/level receive its own art later without
  // changing technology, province, or dossier code.
  'structure-missile': { kind: 'img', value: ironfrontsPng('structure-ordnance-icon') },
  'building-fields': { kind: 'img', value: png('food') },
  'building-quarry': { kind: 'img', value: png('stone') },
  'building-mine': { kind: 'img', value: png('metal') },
  'building-oil-pump': { kind: 'svg', value: svg('oil') },
  // Reserved — committed painterly art (project owner, see ASSET_CREDITS.md)
  // with no wired mechanic yet: no fortress / city building, no army-stance system.
  'structure-fortress': { kind: 'img', value: ironfrontsPng('fortress') },
  'structure-city': { kind: 'img', value: ironfrontsPng('settlement') },
  'stance-attack': { kind: 'img', value: ironfrontsPng('stance-attack') },
  'stance-attack-defend': { kind: 'img', value: ironfrontsPng('stance-attack-defend') },
  'stance-defend': { kind: 'img', value: ironfrontsPng('stance-defend') },
  'stance-retreat': { kind: 'img', value: ironfrontsPng('stance-retreat') },
  'stance-defend-retreat': { kind: 'img', value: ironfrontsPng('stance-defend-retreat') },
  'rank-basic': { kind: 'img', value: png('ranks/Basic') },
  'rank-advanced': { kind: 'img', value: png('ranks/Advanced') },
  'rank-elite': { kind: 'img', value: png('ranks/Elite') },
};

export function createIcon(name: IconName, className = ''): HTMLElement {
  const def = ICONS[name];
  const wrap = document.createElement('span');
  wrap.className = `ifg-icon${className ? ` ${className}` : ''}`;
  wrap.dataset.kind = def.kind;
  wrap.setAttribute('aria-hidden', 'true');
  if (def.kind === 'img') {
    const img = document.createElement('img');
    img.src = def.value;
    img.alt = '';
    img.draggable = false;
    wrap.appendChild(img);
  } else {
    wrap.innerHTML = def.value;
  }
  return wrap;
}

/** Icon for a raw stockpile resource key (as used in cost/deposit objects). */
export const RESOURCE_ICON: Record<'funds' | 'manpower' | 'food' | 'stone' | 'metal' | 'oil', IconName> = {
  funds: 'funds', manpower: 'manpower', food: 'food', stone: 'node-stone', metal: 'metal', oil: 'oil',
};

export function iconMarkup(name: IconName, className = ''): string {
  const def = ICONS[name];
  const cls = `ifg-icon${className ? ` ${className}` : ''}`;
  return def.kind === 'img'
    ? `<span class="${cls}" data-kind="img" aria-hidden="true"><img src="${def.value}" alt="" draggable="false"></span>`
    : `<span class="${cls}" data-kind="svg" aria-hidden="true">${def.value}</span>`;
}
