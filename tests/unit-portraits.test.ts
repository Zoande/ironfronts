/**
 * Guards the dev-only Call of War prototype-art loader: it must never give
 * Vite/Rollup a build-time reference to dev-assets/callofwar-reference (an
 * eager OR lazy import.meta.glob on that path was proven, empirically, to
 * still ship the copyrighted images into `dist/assets` on `vite build` even
 * behind an `import.meta.env.DEV` guard — Vite's glob transform enumerates
 * matches at parse time, before any dead-code elimination runs). A plain
 * runtime template-literal URL carries no such reference.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { unitPortraitMarkup } from '../src/ui/unit-portraits';

describe('unit-portraits dev prototype loader', () => {
  const source = readFileSync('src/ui/unit-portraits.ts', 'utf8');

  it('never references dev-assets via import.meta.glob', () => {
    expect(source).not.toMatch(/import\.meta\.glob\([^)]*dev-assets/);
  });

  it('resolves the prototype directory only through a runtime template string', () => {
    expect(source).toMatch(/`\/dev-assets\/callofwar-reference\/\$\{stem\}\.webp`/);
  });

  it('falls back to the committed SVG for every real roster id', () => {
    for (const id of ['infantry', 'engineer', 'armored-car', 'light-tank', 'medium-tank', 'artillery']) {
      expect(unitPortraitMarkup(id)).toContain('<svg');
    }
  });

  it('falls back to the generic SVG for an unknown id', () => {
    expect(unitPortraitMarkup('not-a-real-unit')).toContain('<svg');
  });
});
