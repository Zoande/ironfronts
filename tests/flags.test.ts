import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COUNTRY_FLAG, resolveFlagUrl } from '../src/ui/flags';

const root = process.cwd();
const flagsDir = path.join(root, 'src/ui/assets/flags');
const flagFiles = new Set(readdirSync(flagsDir).filter((file) => file.endsWith('.svg')));
const worldCountryNames = JSON.parse(readFileSync(path.join(root, 'public/world/world.json'), 'utf8'))
  .politics.countries.map((country: { name: string }) => country.name) as string[];

/**
 * Every authored country needs a real, locally vendored flag. Regional entries
 * intentionally inherit the flag of their historical sovereign or administrator;
 * unknown text alone still safely resolves to the neutral colour standard.
 */
describe('1939 flag resolver', () => {
  it('gives sovereign belligerents their period flag, not a modern replacement', () => {
    expect(COUNTRY_FLAG.Italy).toBe('it-1861-1946');
    expect(COUNTRY_FLAG.Greece).toBe('gr-1935-1970');
    expect(COUNTRY_FLAG.Persia).toBe('ir-1925-1979');
    expect(COUNTRY_FLAG['Nationalist China']).toBe('cn-roc');
    expect(COUNTRY_FLAG.Spain).toBe('es-1938-1945');
    expect(COUNTRY_FLAG.Lithuania).toBe('lt-1918-1940');
    expect(COUNTRY_FLAG.Afghanistan).toBe('af-1931-1973');
    expect(COUNTRY_FLAG.Tibet).toBe('tibet-1916-1951');
    expect(COUNTRY_FLAG.Mengjiang).toBe('mengjiang-1939-1945');
    for (const name of ['Italy', 'Greece', 'Persia', 'Nationalist China', 'Egypt']) {
      expect(resolveFlagUrl(name), name).toBeTruthy();
    }
  });

  // Germany deliberately uses the modern flag rather than the period
  // (swastika) one, an explicit exception to the "period flag" rule above.
  it('gives Germany the modern flag, not the period swastika one', () => {
    expect(COUNTRY_FLAG.Germany).toBe('de');
    expect(resolveFlagUrl('Germany')).toBeTruthy();
  });

  it('resolves colonies to their administering power', () => {
    expect(resolveFlagUrl('Belgian Congo')).toBe(resolveFlagUrl('Belgium'));
    expect(resolveFlagUrl('Angola')).toBe(resolveFlagUrl('Portugal'));
    expect(resolveFlagUrl('Libya')).toBe(resolveFlagUrl('Italy'));
    expect(resolveFlagUrl('Algeria')).toBe(resolveFlagUrl('France'));
    expect(resolveFlagUrl('Nigeria')).toBe(resolveFlagUrl('United Kingdom'));
  });

  it('gives every country in the authoritative world a locally bundled flag', () => {
    expect(worldCountryNames).toHaveLength(200);
    expect(Object.keys(COUNTRY_FLAG).sort()).toEqual([...worldCountryNames].sort());
    for (const name of worldCountryNames) {
      expect(resolveFlagUrl(name), name).toBeTruthy();
    }
  });

  it('uses parent flags for regional gameplay subdivisions and falls back safely for unknowns', () => {
    expect(resolveFlagUrl('California')).toBe(resolveFlagUrl('Texas'));
    expect(resolveFlagUrl('Siberia')).toBe(resolveFlagUrl('Kazakhstan'));
    expect(resolveFlagUrl('São Paulo')).toBe(resolveFlagUrl('Mato Grosso'));
    expect(resolveFlagUrl('Queensland')).toBe(resolveFlagUrl('Tasmania'));
    expect(resolveFlagUrl('Nowhere')).toBeNull();
    expect(resolveFlagUrl(null)).toBeNull();
    expect(resolveFlagUrl(undefined)).toBeNull();
  });

  it('never throws, whatever it is handed', () => {
    for (const input of ['', '   ', '\0', 'Germany'.repeat(50)]) {
      expect(() => resolveFlagUrl(input)).not.toThrow();
    }
  });

  it('every mapped stem points at a vendored asset that exists on disk', () => {
    const stems = Object.values(COUNTRY_FLAG);
    expect(stems).toHaveLength(200);
    for (const stem of new Set(stems)) {
      expect(flagFiles.has(stem + '.svg'), stem + '.svg missing').toBe(true);
    }
  });

  it('every vendored historical flag carries a source and licence comment', () => {
    for (const file of flagFiles) {
      if (!/[0-9]|roc|manchukuo|empire/.test(file)) continue;
      const svg = readFileSync(path.join(flagsDir, file), 'utf8').slice(0, 400);
      expect(svg, file).toMatch(/commons\.wikimedia\.org/);
      expect(svg, file).toMatch(/[Pp]ublic domain|PD-|CC BY-SA/);
    }
  });

  it('every vendored SVG decodes as a real image, not a blank swatch', () => {
    // Regression: a leading `<!-- comment -->` before an `<?xml ?>` declaration,
    // or a stray BOM anywhere but byte 0, makes Chrome's <img>-decoder silently
    // reject the file (naturalWidth 0) even though it fetches fine and looks
    // like valid SVG — file-existence and licence-comment checks above never
    // caught this. de-1935-1945 (Germany), su-1936-1955, et-empire,
    // eg-1922-1958 and cn-roc all shipped broken this way.
    for (const file of flagFiles) {
      const raw = readFileSync(path.join(flagsDir, file), 'utf8');
      expect(raw.indexOf('﻿'), `${file}: stray BOM`).toBe(-1);
      const commentEnd = raw.indexOf('-->');
      const declarationStart = raw.indexOf('<?xml');
      if (commentEnd !== -1 && declarationStart !== -1) {
        expect(declarationStart, `${file}: <?xml declaration must not follow a leading comment`)
          .toBeLessThan(commentEnd);
      }
    }
  });

  it('documents provenance and complete scenario coverage in docs/flags.md', () => {
    const doc = readFileSync(path.join(root, 'docs/flags.md'), 'utf8');
    expect(doc).toMatch(/de\.svg/);
    expect(doc).toMatch(/flag-icons/i);
    expect(doc).toMatch(/every country/i);
  });
});
