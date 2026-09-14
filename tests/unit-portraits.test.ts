/**
 * Unit portraits: committed painterly PNGs (project owner) take precedence
 * over the inline SVG, which stays as the fallback for roster ids with no PNG
 * and for unknown ids. The old dev-only Call of War reference loader is gone.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { unitPortraitMarkup } from '../src/ui/unit-portraits';

describe('unit portraits', () => {
  const source = readFileSync('src/ui/unit-portraits.ts', 'utf8');

  it('bundles the raster portraits via an eager glob and prefers them', () => {
    expect(source).toContain("import.meta.glob('./assets/units/*.png'");
    expect(source).toMatch(/const raster = rasterPortrait\(unitFamilyId\(typeId\)\);\s*\n\s*if \(raster\)/);
  });

  it('no longer references the dev-only Call of War prototype directory', () => {
    expect(source).not.toMatch(/dev-assets/);
    expect(source).not.toMatch(/callofwar-reference/);
  });

  it('falls back to the committed SVG markup for every real roster id', () => {
    for (const id of ['infantry', 'engineer', 'armored-car', 'light-tank', 'medium-tank', 'artillery']) {
      expect(unitPortraitMarkup(id)).toContain('<svg');
    }
  });

  it('falls back to the generic SVG for an unknown id', () => {
    expect(unitPortraitMarkup('not-a-real-unit')).toContain('<svg');
  });
});
