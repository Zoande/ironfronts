import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createInitialState } from '../src/ui/ui-state';
import { POLITICAL_OVERVIEW_FULL_ALTITUDE } from '../src/shaders/terrain';

const root = process.cwd();

describe('map behavior regressions', () => {
  it('starts in strategic mode across state, renderer, and fallback controls', () => {
    const renderer = readFileSync(path.join(root, 'src/renderer.ts'), 'utf8');
    const html = readFileSync(path.join(root, 'index.html'), 'utf8');
    expect(createInitialState().mapMode).toBe('balanced');
    expect(renderer).toContain("private mapMode: MapMode = 'balanced'");
    expect(html).toMatch(/value="balanced" checked[^>]*\/> Strategic map/);
    expect(html).not.toMatch(/value="political" checked/);
  });

  it('reaches the full strategic political tint at 3500 altitude', () => {
    expect(POLITICAL_OVERVIEW_FULL_ALTITUDE).toBe(3_500);
  });

  it('keeps diagnostics above the HUD map modes', () => {
    const css = readFileSync(path.join(root, 'src/styles.css'), 'utf8');
    expect(css).toMatch(/\.diagnostics\s*\{[^}]*z-index:\s*50/s);
  });

  it('does not expose or upload resource-node map icons', () => {
    const main = readFileSync(path.join(root, 'src/main.ts'), 'utf8');
    const ui = readFileSync(path.join(root, 'src/ui/game-ui.ts'), 'utf8');
    expect(main).not.toContain('syncResourceMarkers');
    expect(main).not.toContain('setResourceOverlay(true)');
    expect(ui).not.toContain('overlayToggle');
  });
});
