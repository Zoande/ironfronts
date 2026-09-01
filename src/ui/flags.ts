/**
 * Country flag registry.
 *
 * Keyed by the in-game country name. Ironfronts is a September 1939 scenario, so
 * entries point at historically appropriate art for that date, not modern flags:
 *  - Sovereign belligerents get their 1939 flag (the Kingdom of Italy, the
 *    1935-1945 German flag, imperial Persia's Lion and Sun, and so on).
 *  - Real colonies / mandates resolve to the flag of the power that actually
 *    administered them in 1939 (French, British, Belgian, Portuguese, Italian).
 *  - Fictional gameplay subdivisions (US states, Brazilian regions, Soviet
 *    oblasts, warlord cliques) intentionally resolve to `null` and render a
 *    colour *standard* — a deliberate scenario fallback, never an invented flag.
 *
 * Provenance and licensing for every vendored file: docs/flags.md.
 */

const flagUrls = import.meta.glob('./assets/flags/*.svg', {
  eager: true, query: '?url', import: 'default',
}) as Record<string, string>;

/**
 * In-game country name -> flag asset stem in ./assets/flags/<stem>.svg.
 *
 * A bare ISO code is a flag-icons file (MIT) whose modern art is unchanged
 * since 1939 (plain tricolours, Nordic crosses, the Hinomaru, the Union Jack).
 * A dated / descriptive stem is a period flag vendored from Wikimedia Commons
 * (all PD-old) specifically for this scenario — see docs/flags.md.
 */
const COUNTRY_FLAG: Record<string, string> = {
  // --- sovereign belligerents, 1939 flags ---
  Germany: 'de-1935-1945',
  Italy: 'it-1861-1946',
  Spain: 'es', // Nationalist state flag (1938-45) still to be vendored — see docs/flags.md
  Greece: 'gr-1935-1970',
  Yugoslavia: 'yu-1918-1941',
  Romania: 'ro', // civil tricolour; royal-arms variant not yet vendored
  Egypt: 'eg-1922-1958',
  'South Africa': 'za-1928-1994',
  Ethiopia: 'et-empire',
  Iraq: 'iq-1921-1959',
  Persia: 'ir-1925-1979',
  'Nationalist China': 'cn-roc',
  // unchanged since 1939 — flag-icons art is period-correct
  Finland: 'fi',
  Poland: 'pl',
  France: 'fr',
  'United Kingdom': 'gb',
  Turkey: 'tr',
  Japan: 'jp',
  Sweden: 'se',
  'New Zealand': 'nz',
  'Saudi Arabia': 'sa',
  Portugal: 'pt',
  Belgium: 'be',
  Netherlands: 'nl',
  Luxembourg: 'lu',
  Switzerland: 'ch',
  Austria: 'at',
  Denmark: 'dk',
  Norway: 'no',
  Ireland: 'ie',
  Iceland: 'is',
  Bulgaria: 'bg',
  Czechoslovakia: 'cz',

  // --- puppet state ---
  Manchukuo: 'manchukuo',

  // --- real 1939 colonies / mandates: administering power's flag ---
  Libya: 'it-1861-1946',
  'Belgian Congo': 'be',
  Angola: 'pt',
  Algeria: 'fr',
  Mauritania: 'fr',
  'French Sudan': 'fr',
  'Upper Volta': 'fr',
  'Equatorial Gabon': 'fr',
  Madagascar: 'fr',
  Syria: 'fr',
  Indochina: 'fr',
  Nigeria: 'gb',
  Bechuanaland: 'gb',
  Tanganyika: 'gb',
  Burma: 'gb',
  Pakistan: 'gb',
  'North India': 'gb',
  'South India': 'gb',
  'British Odisha': 'gb',
  'North Sudan': 'gb',
  'South Sudan': 'gb',
};

export function resolveFlagUrl(country: string | null | undefined): string | null {
  if (!country) return null;
  const stem = COUNTRY_FLAG[country];
  if (!stem) return null;
  return flagUrls[`./assets/flags/${stem}.svg`] ?? null;
}

export function hasFlag(country: string | null | undefined): boolean {
  return resolveFlagUrl(country) !== null;
}

/**
 * Flag chit. A real flag when art exists for `country`, otherwise a colour
 * standard tinted with `color`. `variant` tunes the size/treatment for where
 * it sits (top bar vs. an inline province owner line).
 */
export function createFlag(
  country: string | null,
  color: string,
  variant: 'command' | 'inline' = 'inline',
): HTMLElement {
  const el = document.createElement('span');
  el.className = 'ifg-flag';
  el.dataset.variant = variant;
  el.setAttribute('aria-hidden', 'true');
  const url = resolveFlagUrl(country);
  if (url) {
    el.dataset.kind = 'flag';
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.draggable = false;
    el.appendChild(img);
  } else {
    el.dataset.kind = 'standard';
    el.style.setProperty('--standard', color || '#8a8f88');
  }
  return el;
}
