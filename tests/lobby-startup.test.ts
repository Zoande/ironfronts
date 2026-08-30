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
    expect(main).toContain("await import('./renderer')");
    expect(main).toContain("import type { WorldRenderer, MapMode, TimeOfDayState } from './renderer';");
    expect(main).not.toMatch(/import\s+\{\s*WorldRenderer[,}]/);
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

  it('does not create a Web Audio context while merely priming the lobby', () => {
    const audio = readFileSync(path.join(root, 'src/audio/audio-manager.ts'), 'utf8');
    const start = audio.indexOf('prime(musicUrls: readonly string[] = [])');
    const end = audio.indexOf('prepareMusic(url: string)', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const prime = audio.slice(start, end);
    expect(prime).toContain('this.prepareMusic(url)');
    expect(prime).not.toContain('this.loadBuffer(');
    expect(prime).not.toContain('this.ensureContext(');
  });
});
