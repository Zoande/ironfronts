/**
 * HUD icon registry.
 *
 * Two tiers, on purpose:
 *  - painterly resource / action icons from 0 A.D. (CC BY-SA 3.0, see
 *    docs/ASSET_CREDITS.md) rendered as <img>;
 *  - flat monochrome line icons authored for Ironfronts, inlined as SVG so
 *    they inherit `currentColor` for hover / active states.
 *
 * No Unicode / emoji glyphs anywhere in the player HUD.
 */

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
  | 'diplomacy' | 'economy' | 'objectives' | 'events' | 'provinces'
  | 'resource-overlay' | 'close' | 'focus' | 'expand' | 'system'
  | 'weather-clear' | 'weather-rain'
  | 'note-warning' | 'note-combat' | 'note-completed' | 'note-diplomacy' | 'note-information'
  | 'node-stone' | 'node-metal' | 'node-oil' | 'resource-water'
  | 'cmd-move' | 'cmd-attack' | 'cmd-retreat' | 'cmd-split' | 'cmd-stop' | 'cmd-extract'
  | 'cmd-patrol' | 'cmd-garrison'
  | 'stat-health' | 'stat-attack' | 'stat-defence' | 'stat-speed' | 'stat-troops'
  | 'structure-barracks' | 'structure-plant' | 'structure-ordnance'
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
  // Army command grid — 0 A.D. session icons where the action is generic
  // (attack, stop, patrol, garrison, split/groups); authored WW2-neutral
  // glyphs for move / retreat / extract, which 0 A.D. has no clean art for.
  'cmd-move': { kind: 'svg', value: svg('move') },
  'cmd-attack': { kind: 'img', value: png('kill') },
  'cmd-retreat': { kind: 'svg', value: svg('retreat') },
  'cmd-split': { kind: 'img', value: png('groups') },
  'cmd-stop': { kind: 'img', value: png('stop') },
  'cmd-extract': { kind: 'svg', value: svg('pickaxe') },
  'cmd-patrol': { kind: 'img', value: png('patrol') },
  'cmd-garrison': { kind: 'img', value: png('garrison') },
  'stat-health': { kind: 'img', value: png('heal') },
  'stat-attack': { kind: 'svg', value: svg('crossed-blades') },
  'stat-defence': { kind: 'svg', value: svg('shield') },
  'stat-speed': { kind: 'svg', value: svg('speed') },
  'stat-troops': { kind: 'svg', value: svg('troops') },
  'structure-barracks': { kind: 'img', value: png('training') },
  'structure-plant': { kind: 'img', value: png('production') },
  'structure-ordnance': { kind: 'img', value: png('construction') },
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

export function iconMarkup(name: IconName, className = ''): string {
  const def = ICONS[name];
  const cls = `ifg-icon${className ? ` ${className}` : ''}`;
  return def.kind === 'img'
    ? `<span class="${cls}" data-kind="img" aria-hidden="true"><img src="${def.value}" alt="" draggable="false"></span>`
    : `<span class="${cls}" data-kind="svg" aria-hidden="true">${def.value}</span>`;
}
