import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/ui/game-ui.css', import.meta.url), 'utf8');
const armyUi = readFileSync(new URL('../src/ui/army.ts', import.meta.url), 'utf8');

describe('selected army panel containment', () => {
  it('locks the overlay height and contains variable content inside its sections', () => {
    expect(css).toContain('height: 244px;');
    expect(css).toContain('max-height: calc(100vh - 36px);');
    expect(css).toMatch(/\.ifg-army-panel__body\s*\{[^}]*height: calc\(100% - 34px\);[^}]*overflow: hidden;/s);
    expect(css).toMatch(/\.ifg-army-panel__activity\s*\{[^}]*overflow: hidden;/s);
    expect(css).toMatch(/\.ifg-army-panel__units\s*\{[^}]*overflow: hidden;/s);
  });

  it('renders one aggregate battle card instead of unbounded front and retreat lists', () => {
    expect(armyUi).toContain('summarizeBattleFronts');
    expect(armyUi).toContain("'Selected forces'");
    expect(armyUi).toContain("'Opposing forces'");
    expect(armyUi).not.toContain('Retreat exit ${index + 1}');
  });

  it('puts operational activity in the header and supply-safe metrics with composition', () => {
    expect(armyUi).toContain('ifg-army-panel__header-activity');
    expect(armyUi).toContain("createIcon('supply'");
    expect(armyUi).toContain("'ifg-army-panel__composition-header'");
    expect(armyUi).not.toContain("'Supply pressure'");
    expect(css).toContain('.ifg-army-panel__naval-track');
    expect(css).toContain('.ifg-army-panel__activity-time');
  });

  it('floats illustrated wide commands above a compact health and combat-profile column', () => {
    expect(armyUi).toContain('host.replaceChildren(commands, header, body)');
    expect(armyUi).toContain('body.append(summary, center, report)');
    expect(armyUi).toContain("node('table', 'ifg-army-panel__stat-table')");
    expect(css).toMatch(/\.ifg-army-panel__commands--primary\s*\{[^}]*bottom: calc\(100% \+ 9px\)/s);
    expect(css).toMatch(/\.ifg-army-panel__commands--primary \.ifg-army-panel__command\s*\{[^}]*width: 72px;[^}]*height: 48px;/s);
    expect(css).toContain("--ifg-skin-control: url('./assets/skins/hud-control-plate.png')");
    expect(css).toContain("--ifg-skin-building: url('./assets/skins/hud-building-plaque.png')");
    expect(css).toContain("--ifg-skin-queue: url('./assets/skins/hud-queue-slot.png')");
    expect(css).toContain('-webkit-mask-image: var(--ifg-skin-unit-mask);');
    expect(css).toMatch(/\.ifg-army-panel__summary\s*\{[^}]*grid-template-rows: 92px minmax\(0, 1fr\)/s);
    expect(armyUi).toContain('report.append(activity)');
  });
});
