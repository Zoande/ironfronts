import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { consumeCatalogDossierEscape } from '../src/ui/catalog-dossier';

const source = readFileSync(path.join(process.cwd(), 'src/ui/game-ui.ts'), 'utf8');
const catalogSource = readFileSync(path.join(process.cwd(), 'src/ui/catalog-dossier.ts'), 'utf8');

describe('technology dossier accessibility wiring', () => {
  it('uses a labelled tabpanel and the horizontal ARIA keyboard pattern', () => {
    expect(source).toContain("techBody.setAttribute('role', 'tabpanel')");
    expect(source).toContain("tab.addEventListener('keydown'");
    expect(source).toContain('technologyTabAfterKey(category.id, event.key)');
    expect(source).toContain("tab.id = `ifg-tech-tab-${category.id}`");
    expect(source).toContain("techBody.setAttribute('aria-labelledby', `ifg-tech-tab-${selectedTechTab}`)");
  });

  it('restores focus after rerenders and when the dossier closes', () => {
    expect(source).toContain('restoreTechnologyFocus(focusTarget)');
    expect(source).toContain('captureTechnologyViewport()');
    expect(source).toContain('restoreTechnologyViewport(viewportState');
    expect(source).toContain("tile.dataset.techFocus = `unlock:${unlock.kind}:${unlock.id}:${unlock.level}`");
    expect(source).toContain("action.dataset.techFocus = 'authorize'");
    expect(source).toContain("item.setAttribute('aria-label'");
    expect(source).toContain("renderedSidePanel === 'research' && state.activeSidePanel === null");
    expect(source).toContain('technologyDockButton?.focus({ preventScroll: true })');
  });

  it('moves focus into catalogue dossiers, traps it, and restores the opener', () => {
    expect(catalogSource).toContain('consumeCatalogDossierEscape(event, shut)');
    expect(catalogSource).toContain('event.stopPropagation()');
    expect(catalogSource).toContain("if (event.key !== 'Tab') return");
    expect(catalogSource).toContain('sibling.inert = true');
    expect(catalogSource).toContain('close.focus({ preventScroll: true })');
    expect(catalogSource).toContain('returnFocus?.focus({ preventScroll: true })');
    expect(catalogSource).toContain('opener?.isConnected');
  });

  it('consumes Escape before the underlying Technology panel can close', () => {
    let prevented = false;
    let propagationStopped = false;
    let dossierOpen = true;
    let technologyOpen = true;

    const consumed = consumeCatalogDossierEscape({
      key: 'Escape',
      preventDefault: () => { prevented = true; },
      stopPropagation: () => { propagationStopped = true; },
    }, () => { dossierOpen = false; });

    if (!propagationStopped) technologyOpen = false;

    expect(consumed).toBe(true);
    expect(prevented).toBe(true);
    expect(dossierOpen).toBe(false);
    expect(technologyOpen).toBe(true);
  });
});
