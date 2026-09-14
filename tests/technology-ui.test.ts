import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const ui = readFileSync(path.join(root, 'src/ui/game-ui.ts'), 'utf8');
const css = readFileSync(path.join(root, 'src/ui/game-ui.css'), 'utf8');

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
    expect(css).toMatch(/\.ifg-tech__track\s*\{[^}]*grid-template-columns:\s*repeat\(8/s);
    expect(css).toMatch(/\.ifg-tech__cell:not\(:first-child\)::before\s*\{[^}]*left: calc\(-50% \+ 34px\)/s);
    expect(css).toMatch(/\.ifg-tech__rail\s*\{[^}]*height: 100%;[^}]*overflow: hidden;/s);
  });

  it('ships placeholder infantry lines and a wired resource dependency branch', () => {
    expect(ui).toContain("id: 'militia'");
    expect(ui).toContain("id: 'commandos'");
    expect(ui.match(/comingSoon: true/g)).toHaveLength(2);
    expect(ui).toContain("technology: 'resourceBuildings'");
    expect(ui).toContain("el('i', 'ifg-tech__dependency')");
    expect(css).toContain('.ifg-tech__coming-soon');
    expect(css).toContain('.ifg-tech__dependency');
    expect(css).toMatch(/\.ifg-tech__dependency\s*\{[^}]*width: 100%;[^}]*border-left:/s);
    expect(ui).toContain("icon: 'unit-infantry'");
    expect(ui).toContain("shortLabel: 'Mobile Support', icon: 'unit-armored-car'");
  });
});
