import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const gameUi = readFileSync(path.join(process.cwd(), 'src/ui/game-ui.ts'), 'utf8');

describe('technology command UI', () => {
  it('exposes Technology from the normal command dock', () => {
    expect(gameUi).toContain("{ id: 'research', label: 'Technology'");
    expect(gameUi).toContain("section.id === 'diplomacy' || section.id === 'research'");
    expect(gameUi).toContain("b.setAttribute('aria-controls', 'ifg-technology-panel')");
  });

  it('renders all five branches and starts research through the real command path', () => {
    for (const branch of ['infantry', 'resources', 'training', 'hybrid', 'armored']) {
      expect(gameUi).toContain(`{ id: '${branch}'`);
    }
    expect(gameUi).toContain('start.onclick = () => actions.researchTechnology(current.id)');
    expect(gameUi).toContain('No resources required · one project at a time');
  });
});
