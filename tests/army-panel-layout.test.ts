import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/ui/game-ui.css', import.meta.url), 'utf8');
const armyUi = readFileSync(new URL('../src/ui/army.ts', import.meta.url), 'utf8');

describe('selected army panel containment', () => {
  it('locks the overlay height and contains variable content inside its sections', () => {
    expect(css).toContain('height: 286px;');
    expect(css).toContain('max-height: calc(100vh - 36px);');
    expect(css).toMatch(/\.ifg-army-panel__body\s*\{[^}]*height: calc\(100% - 34px\);[^}]*overflow: hidden;/s);
    expect(css).toMatch(/\.ifg-army-panel__activity\s*\{[^}]*overflow: auto;/s);
    expect(css).toMatch(/\.ifg-army-panel__units\s*\{[^}]*overflow: auto;/s);
  });

  it('renders one aggregate battle card instead of unbounded front and retreat lists', () => {
    expect(armyUi).toContain('summarizeBattleFronts');
    expect(armyUi).toContain("'Selected forces'");
    expect(armyUi).toContain("'Opposing forces'");
    expect(armyUi).not.toContain('Retreat exit ${index + 1}');
  });

  it('floats square commands above a compact health and combat-profile column', () => {
    expect(armyUi).toContain('host.replaceChildren(commands, header, body)');
    expect(armyUi).toContain('body.append(summary, center, report)');
    expect(armyUi).toContain("node('table', 'ifg-army-panel__stat-table')");
    expect(css).toMatch(/\.ifg-army-panel__commands--primary\s*\{[^}]*bottom: calc\(100% \+ 9px\)/s);
    expect(css).toMatch(/\.ifg-army-panel__commands--primary \.ifg-army-panel__command\s*\{[^}]*width: 50px;[^}]*height: 50px;/s);
    expect(css).toMatch(/\.ifg-army-panel__summary\s*\{[^}]*grid-template-rows: 92px minmax\(0, 1fr\)/s);
    expect(armyUi).toContain('report.append(activity)');
  });
});
