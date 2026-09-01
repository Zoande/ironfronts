import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

describe('lightweight lobby startup', () => {
  it('keeps the world and loading scene dormant before launch', () => {
    const html = readFileSync(path.join(root, 'index.html'), 'utf8');
    expect(html).toMatch(/<canvas id="world"[^>]*\shidden>/);
    expect(html).toMatch(/<section id="loading"[^>]*\shidden>/);
  });

  it('loads the renderer only after the player launches an operation', () => {
    const main = readFileSync(path.join(root, 'src/main.ts'), 'utf8');
    // The renderer module graph is still loaded lazily, only once the player
    // commits to an operation (now wrapped in a launch-timeout guard).
    expect(main).toMatch(/(await |withTimeout\()import\('\.\/renderer'\)/);
    expect(main).toContain("import type { WorldRenderer, MapMode, TimeOfDayState } from './renderer';");
    expect(main).not.toMatch(/import\s+\{\s*WorldRenderer[,}]/);
  });

  it('cannot let optional opening music block Continue or a new deployment', () => {
    const main = readFileSync(path.join(root, 'src/main.ts'), 'utf8');
    // A new operation registers (join) only when no country is assigned yet; a
    // Continue skips straight to the renderer. Either way the join call is
    // time-bounded so it can never hang the launch.
    expect(main).toContain('if (lobby.assignedCountryId === null)');
    expect(main).toMatch(/withTimeout\(joinGame\(countryId\)/);
    expect(main).toContain("void music.setState('opening').catch");
    expect(main).not.toContain("await music.setState('opening')");
  });

  it('restores authoritative territorial ownership before the first continued frame', () => {
    const main = readFileSync(path.join(root, 'src/main.ts'), 'utf8');
    const bootstrap = main.slice(main.indexOf('async function bootstrapGameSession'));
    expect(bootstrap).toContain('renderer.setProvinceOwners(Object.entries(session.state.provinceOwners)');
  });

  it('shows retreat-exit circles only while the player is choosing a route', () => {
    const main = readFileSync(path.join(root, 'src/main.ts'), 'utf8');
    expect(main).toContain("army.status === 'engaged' && targetingMode === 'retreat'");
  });

  it('does not use a media-element preload for lobby music warming', () => {
    const audio = readFileSync(path.join(root, 'src/audio/audio-manager.ts'), 'utf8');
    const start = audio.indexOf('prepareMusic(url: string)');
    const end = audio.indexOf('async playUiCue', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const prepareMusic = audio.slice(start, end);
    expect(prepareMusic).toContain("fetch(url, { cache: 'force-cache' })");
    expect(prepareMusic).not.toContain('new Audio()');
  });
});
