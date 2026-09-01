/**
 * Unit portrait cards.
 *
 * Committed / production art: original WW2-style vector portraits authored
 * for Ironfronts (not scraped game art). The card layout and "one image,
 * minimal name, details on hover" presentation is inspired by Call of War's
 * unit list; the drawings are our own, faction-neutral field-grey / steel,
 * and inlined as SVG so they scale crisply and inherit the panel background.
 *
 * Keyed by the six real roster ids in `game/units/unit-catalog.ts`, with a
 * generic fallback — deliberately no portraits for unit families the roster
 * cannot build yet (militia, motorised, mechanised, paratroopers …), so the
 * panel never advertises a unit that does not exist.
 *
 * Dev-only prototype layer: `dev-assets/callofwar-reference/<id>.webp` (git-
 * ignored, never committed, never shipped) holds the actual Call of War wiki
 * portraits — pulled in ONLY when `import.meta.env.DEV` is true, purely so the
 * intended visual target is visible while iterating locally. A production
 * build always uses the SVG above regardless of what happens to be on disk,
 * and the glob resolves to an empty object (no build failure) when the
 * directory doesn't exist, e.g. on a fresh checkout or CI. See that
 * directory's README before treating this as anything but a local reference.
 */

const raw = import.meta.glob('./assets/units/*.svg', {
  eager: true, query: '?raw', import: 'default',
}) as Record<string, string>;

const portrait = (stem: string): string => raw[`./assets/units/${stem}.svg`];

// Deliberately NOT import.meta.glob (eager or lazy): Vite's glob transform
// statically enumerates matching files and wires them into Rollup's module
// graph at parse time, before any import.meta.env.DEV dead-code elimination
// runs — a `DEV`-guarded glob call still shipped every file into dist/assets
// in testing here. A plain runtime template-literal URL carries no build-time
// reference at all, so Rollup has nothing to discover; the dev server (which
// serves the whole project root, not just public/) resolves it with an
// ordinary fetch, and a production build never touches this directory.
const PROTOTYPE_STEMS = new Set(['infantry', 'armored-car', 'light-tank', 'medium-tank', 'artillery']);
function prototypeUrl(stem: string): string | undefined {
  if (!import.meta.env.DEV || !PROTOTYPE_STEMS.has(stem)) return undefined;
  return `/dev-assets/callofwar-reference/${stem}.webp`;
}

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
  return PORTRAIT_BY_TYPE[typeId] ?? portrait('_fallback');
}

/**
 * A framed portrait element for a composition card. Renders the SVG
 * immediately; in dev, if a local Call of War reference image exists for this
 * unit id, it swaps in once the browser loads it, flagged with
 * `data-prototype` so CSS can mark it and it's never mistaken for shipped
 * art. Production always keeps the SVG, and — see the module doc comment —
 * never even requests the directory.
 */
export function createUnitPortrait(typeId: string, label: string): HTMLElement {
  const frame = document.createElement('span');
  frame.className = 'ifg-army-unit__portrait';
  frame.setAttribute('role', 'img');
  frame.setAttribute('aria-label', label);
  frame.innerHTML = unitPortraitMarkup(typeId);
  const url = prototypeUrl(typeId);
  if (url) {
    const img = document.createElement('img');
    img.onload = () => { frame.dataset.prototype = 'true'; frame.replaceChildren(img); };
    img.onerror = () => { /* no local reference file on disk; SVG stays as-is */ };
    img.src = url;
  }
  return frame;
}
