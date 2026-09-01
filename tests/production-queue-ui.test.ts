import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const gameUi = readFileSync(path.join(root, 'src/ui/game-ui.ts'), 'utf8');
const mainTs = readFileSync(path.join(root, 'src/main.ts'), 'utf8');

describe('0 A.D.-style production/construction queue', () => {
  it('renders the active order as a thumbnail + fill bar + countdown, not plain text', () => {
    expect(gameUi).toContain("fill.style.width = `${Math.round(item.progress * 100)}%`");
    expect(gameUi).toContain('formatEta(item.etaSeconds)');
    expect(gameUi).not.toMatch(/Queue:\s*\$\{/);
    expect(gameUi).not.toMatch(/Under construction:\s*\$\{/);
  });

  it('reuses the unit portrait for produce and the 0 A.D. facility icon for build', () => {
    expect(gameUi).toContain('renderQueue(pvQueue, q, (id, label) => {');
    expect(gameUi).toContain('const thumb = createUnitPortrait(id, label);');
    expect(gameUi).toContain('const icon = FACILITY_ICON[id];');
  });

  it('re-render cache key encodes progress/eta so a filling bar is not treated as unchanged', () => {
    // The old string-join collapsed every queue item to the same
    // "[object Object]" once queue/construction stopped being string arrays —
    // this pins that the key is built from the actual fields instead.
    expect(gameUi).toContain('${q.id}:${Math.round(q.progress * 100)}:${Math.round(q.etaSeconds)}');
  });

  it('computes eta from the fixed normal-speed simulation rate, not a fabricated countdown', () => {
    expect(mainTs).toContain('const GAME_HOURS_PER_REAL_SECOND = 0.5;');
    expect(mainTs).toContain('(o.totalHours - o.progressHours) / GAME_HOURS_PER_REAL_SECOND');
  });
});
