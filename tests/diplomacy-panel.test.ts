import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  diplomacyContactBlock,
  diplomacyRelationLabel,
} from '../src/ui/diplomacy-panel';
import type { DiplomacyCountryView } from '../src/ui/ui-state';

const root = process.cwd();
const panel = readFileSync(path.join(root, 'src/ui/diplomacy-panel.ts'), 'utf8');
const gameUi = readFileSync(path.join(root, 'src/ui/game-ui.ts'), 'utf8');
const main = readFileSync(path.join(root, 'src/main.ts'), 'utf8');
const css = readFileSync(path.join(root, 'src/ui/game-ui.css'), 'utf8');
const credits = readFileSync(path.join(root, 'docs/ASSET_CREDITS.md'), 'utf8');
const viteConfig = readFileSync(path.join(root, 'vite.config.ts'), 'utf8');

function country(overrides: Partial<DiplomacyCountryView> = {}): DiplomacyCountryView {
  return {
    id: 2,
    name: 'France',
    color: '#456f9f',
    alive: true,
    controller: 'player',
    relation: 'neutral',
    unreadCount: 0,
    incomingProposalCount: 0,
    ...overrides,
  };
}

describe('diplomacy side drawer', () => {
  it('uses player-facing labels for every authoritative relation', () => {
    expect(diplomacyRelationLabel('neutral')).toBe('Neutral');
    expect(diplomacyRelationLabel('allied')).toBe('Allied');
    expect(diplomacyRelationLabel('war')).toBe('At war');
  });

  it('only opens a diplomatic channel to a living player-controlled country', () => {
    expect(diplomacyContactBlock(country())).toBeNull();
    expect(diplomacyContactBlock(country({ alive: false }))).toMatch(/defeated/i);
    expect(diplomacyContactBlock(country({ controller: 'ai' }))).toMatch(/another player/i);
    expect(diplomacyContactBlock(country({ controller: 'neutral' }))).toMatch(/another player/i);
  });

  it('exposes treaty, war, response, and private-message controls', () => {
    for (const label of [
      'Propose alliance', 'Declare war', 'Offer peace', 'End alliance',
      'Accept', 'Decline', 'Send cable',
    ]) {
      expect(panel).toContain(`'${label}'`);
    }
    expect(panel).toContain("setAttribute('role', 'log')");
    expect(panel).toContain('text.maxLength = 500');
  });

  it('is a non-modal accessible popup controlled by the diplomacy dock button', () => {
    expect(panel).toContain("const panel = node('section', 'ifg-dip')");
    expect(panel).toContain("const header = node('div', 'ifg-dip__header')");
    expect(panel).toContain("panel.setAttribute('aria-modal', 'false')");
    expect(panel).toContain("panel.setAttribute('aria-labelledby', 'ifg-diplomacy-heading')");
    expect(gameUi).toContain("b.setAttribute('aria-controls', 'ifg-diplomacy-panel')");
    expect(gameUi).toContain("diplomacyDockButton.setAttribute('aria-expanded', String(diplomacyOpen))");
    expect(gameUi).toMatch(/if \(store\.get\(\)\.activeSidePanel\) \{[\s\S]*?event\.stopImmediatePropagation\(\);/);
  });

  it('keeps the side layout responsive and honors reduced-motion preferences', () => {
    expect(css).toMatch(/\.ifg-dip\s*\{[\s\S]*?left: 56px;[\s\S]*?width: min\(780px,/);
    expect(css).toContain('@media (max-width: 680px)');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr);');
    expect(css).toContain('@media (max-height: 520px) and (orientation: landscape)');
    expect(css).toContain('env(safe-area-inset-bottom)');
    expect(css).toMatch(/\.ifg-dip__roster\s*\{[^}]*min-width: 0;[^}]*overflow: hidden;/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?animation: none;/);
  });

  it('does not rebuild the country ledger for unrelated simulation ticks', () => {
    expect(main).toContain('function sameDiplomacyView(');
    expect(main).toContain('if (!sameDiplomacyView(current, next)) uiStore.patch({ diplomacy: next })');
  });

  it('ships and credits the generated cable watermark', () => {
    const asset = path.join(root, 'public/ui/diplomatic-cable-watermark.png');
    expect(existsSync(asset)).toBe(true);
    expect(css).toContain("url('/ui/diplomatic-cable-watermark.png')");
    expect(credits).toContain('diplomatic-cable-watermark.png');
    expect(viteConfig).toContain("{ src: 'public/ui', dest: '.' }");
  });
});
