import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const army = readFileSync(path.join(root, 'src/ui/army.ts'), 'utf8');
const icons = readFileSync(path.join(root, 'src/ui/icons.ts'), 'utf8');

describe('icon-first army command strip', () => {
  it('registers authored monochrome glyphs for every command and stat', () => {
    for (const name of [
      'cmd-move', 'cmd-attack', 'cmd-retreat', 'cmd-split', 'cmd-stop', 'cmd-extract',
      'stat-health', 'stat-attack', 'stat-defence', 'stat-speed', 'stat-troops',
    ]) {
      expect(icons, name).toContain(`'${name}'`);
    }
  });

  it('builds each command as an icon + short caption with the full label on aria-label + rich tooltip', () => {
    const start = army.indexOf('const command = (');
    const body = army.slice(start, army.indexOf('  if (army.own) {', start));
    expect(body).toContain("createIcon(icon, 'ifg-army-panel__command-icon')");
    expect(body).toContain("node('span', 'ifg-army-panel__command-label', caption)");
    expect(body).toContain("button.setAttribute('aria-label', label)");
    // The shared rich tooltip carries the explanation, shortcut and (when
    // blocked) the disabled reason — no bare title="" string.
    expect(body).toContain('bindTooltip(button, () => ({');
    expect(body).toContain('shortcut: tip.shortcut');
    expect(body).toContain('disabledReason: enabled ? undefined');
  });

  it('gives every command a shortcut and a concrete disabled reason', () => {
    for (const [key, reason] of [
      ["shortcut: 'A'", 'No visible hostile target in range.'],
      ["shortcut: 'M'", 'This formation is currently locked in combat.'],
      ["shortcut: 'X'", 'This force is too small to divide.'],
      ["shortcut: 'E'", 'No extractable resource deposit at this position.'],
    ] as const) {
      expect(army, key).toContain(key);
      expect(army, reason).toContain(reason);
    }
    // Retreat still explains the encirclement / close-combat rule.
    expect(army).toContain('Retreat opens once the stack is locked in close combat.');
    expect(army).toContain('No open line of retreat — the stack is encircled.');
  });

  it('shows the combat front as strength bars, not a raw graph-node id', () => {
    expect(army).not.toContain('direction ${front.directionNodeId}');
    // The aggregated battle overview (summarizeBattleFronts) renders per-side
    // health bars, never a bare front/graph-node identifier.
    expect(army).toContain('summarizeBattleFronts(');
    expect(army).toContain("node('span', 'ifg-battle-side__health')");
    expect(army).toContain('healthFill.style.width');
  });
});
