import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const ui = readFileSync(path.join(root, 'src/ui/shell/game-ui.ts'), 'utf8');
const css = readFileSync(path.join(root, 'src/ui/styles/game-ui.css'), 'utf8');

describe('technology tree presentation', () => {
  it('renders horizontal level tracks with two current-research slots and details', () => {
    expect(ui).toContain("el('div', 'ifg-tech__timeline')");
    expect(ui).toContain("el('div', 'ifg-tech__track')");
    expect(ui).toContain("el('div', 'ifg-tech__cell')");
    expect(ui).toContain('for (let slotIndex = 0; slotIndex < 2; slotIndex += 1)');
    expect(ui).toContain("el('section', 'ifg-tech__rail-section ifg-tech__details')");
    expect(ui).toContain('technologyLevelUnlockText(branch, candidate)');
    expect(ui).toContain('bindTooltip(node');
    expect(ui).toContain("for (const resource of ['funds', 'food', 'metal', 'oil'] as const)");
    expect(ui).toContain('state.technology.levelQuotes[selectedTechnology][selectedTechnologyLevel - 1]');
    expect(ui).toContain('const amount = quote.cost[resource]');
    expect(css).toMatch(/\.ifg-tech__track\s*\{[^}]*grid-template-columns:\s*repeat\(8/s);
    expect(css).toMatch(/\.ifg-tech__cell:not\(:first-child\)::before\s*\{[^}]*left: calc\(-50% \+ 34px\)/s);
    expect(css).toMatch(/\.ifg-tech__rail\s*\{[^}]*height: 100%;[^}]*overflow: hidden;/s);
  });

  it('shows level-aware clickable catalogue unlocks', () => {
    expect(ui).toContain('technologyUnlocks(selectedTechnology, selectedTechnologyLevel)');
    expect(ui).toContain("el('button', 'ifg-tech__unlock')");
    expect(ui).toContain('dossier.openUnit(unlock.id)');
    expect(ui).toContain('dossier.openBuilding(unlock.id, unlock.level)');
    expect(ui).toContain('createRankInsignia(candidate');
    expect(ui).toContain("building('missileSite', 'Missile site')");
    expect(css).toContain('.ifg-tech__unlock-grid');
    expect(css).toContain('.ifg-dossier__card');
  });

  it('keeps the visible technology UI terse and uses game building art', () => {
    expect(ui).toContain("techHead.append(el('h2', undefined, 'Technology'))");
    expect(ui).not.toContain('Technology dossiers');
    expect(ui).not.toContain('Directorate of technical development');
    expect(ui).not.toContain('model.branch.summary');
    expect(ui).not.toContain('model.inspected.summary');
    expect(ui).not.toContain('model.inspected.name');
    expect(ui).toContain("el('b', undefined, `Slot ${slotIndex + 1}`)");
    expect(ui).toContain("el('small', undefined, 'Empty')");
    expect(ui).toContain('createIcon(FACILITY_ICON[unlock.id])');
    expect(ui).not.toContain("FACILITY_ICON[unlock.id] ?? 'industry'");
    expect(css).not.toMatch(/\.ifg-tech__briefing\s*\{[^}]*border-left:\s*4px/s);
    expect(css).toMatch(/\.ifg-tech\s*\{[^}]*grid-template-rows:\s*48px 58px/s);
  });

  it('ships placeholder infantry lines and a wired resource dependency branch', () => {
    expect(ui).toContain("id: 'militia'");
    expect(ui).toContain("id: 'commandos'");
    expect(ui.match(/comingSoon: true/g)).toHaveLength(6);
    expect(ui).toContain("technology: 'resourceBuildings'");
    expect(ui).toContain("el('i', 'ifg-tech__dependency')");
    expect(css).toContain('.ifg-tech__coming-soon');
    expect(css).toContain('.ifg-tech__dependency');
    expect(css).toMatch(/\.ifg-tech__dependency\s*\{[^}]*width: 100%;[^}]*border-left:/s);
    expect(ui).toContain("icon: 'unit-infantry'");
    expect(ui).toContain("technology: 'hybrid', label: 'Support', icon: 'unit-armored-car'");
  });
});
