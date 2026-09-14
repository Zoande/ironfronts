/**
 * Unit portrait cards.
 *
 * Two committed layers, raster wins:
 *  - painterly PNG portraits provided by the project owner under
 *    `assets/units/<id>.png` (see docs/ASSET_CREDITS.md), bundled by Vite;
 *  - original WW2-style vector portraits authored for Ironfronts, inlined as
 *    SVG, used for any roster id with no PNG and as the generic fallback.
 *
 * Keyed by the six real roster ids in `game/units/unit-catalog.ts`, with a
 * generic fallback — deliberately no portraits for unit families the roster
 * cannot build yet (militia, motorised, mechanised, paratroopers …), so the
 * panel never advertises a unit that does not exist.
 */

const raw = import.meta.glob('./assets/units/*.svg', {
  eager: true, query: '?raw', import: 'default',
}) as Record<string, string>;

const portrait = (stem: string): string => raw[`./assets/units/${stem}.svg`];

// Committed painterly raster portraits (hand-provided by the project owner,
// downscaled — see docs/ASSET_CREDITS.md). These are real shipped art, so the
// glob deliberately DOES pull them into the bundle; when one exists for a unit
// id it replaces the inline SVG in every build. Ids with no raster keep the SVG.
const rasterUrls = import.meta.glob('./assets/units/*.png', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

const rasterPortrait = (stem: string): string | undefined => rasterUrls[`./assets/units/${stem}.png`];
const familyId = (typeId: string): string => typeId.replace(/-l[2-8]$/, '');

const PORTRAIT_BY_TYPE: Readonly<Record<string, string>> = {
  infantry: portrait('infantry'),
  engineer: portrait('engineer'),
  'armored-car': portrait('armored-car'),
  'light-tank': portrait('light-tank'),
  'medium-tank': portrait('medium-tank'),
  artillery: portrait('artillery'),
};

/** One-line role note per unit family, shown in the portrait-card tooltip. */
export const UNIT_ROLE_NOTE: Readonly<Record<string, string>> = {
  infantry: 'Cheap line infantry — slow, cheap to replace, holds ground and digs in.',
  engineer: 'Pioneers — weak in a fight, fastest at working a resource deposit.',
  'armored-car': 'Fast recon — wide view range, light gun, screens the advance.',
  'light-tank': 'Fast armour — strong against infantry and light targets, mid cost.',
  'medium-tank': 'Frontline armour — expensive, slower, heavy hitter against anything.',
  artillery: 'Ranged support — fires without closing, fragile if caught in the open.',
};

export function unitPortraitMarkup(typeId: string): string {
  return PORTRAIT_BY_TYPE[familyId(typeId)] ?? portrait('_fallback');
}

/**
 * A framed portrait element for a composition card. When a committed raster
 * portrait exists for this unit id it is placed straight into the DOM (the
 * bundled URL is cache-stable, so a panel re-render doesn't flash the image);
 * otherwise the inline SVG is used.
 */
export function createUnitPortrait(typeId: string, label: string): HTMLElement {
  const frame = document.createElement('span');
  frame.className = 'ifg-army-unit__portrait';
  frame.setAttribute('role', 'img');
  frame.setAttribute('aria-label', label);
  const raster = rasterPortrait(familyId(typeId));
  if (raster) {
    const img = document.createElement('img');
    img.src = raster;
    img.alt = '';
    frame.dataset.raster = 'true';
    frame.append(img);
  } else {
    frame.innerHTML = unitPortraitMarkup(typeId);
  }
  return frame;
}
