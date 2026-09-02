import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const main = readFileSync(path.join(root, 'src/main.ts'), 'utf8');

describe('debug lighting clock link', () => {
  it('offers a pressed-state unlink toggle beside the time presets', () => {
    expect(html).toContain('id="debug-time-unlink"');
    expect(html).toContain('aria-pressed="false"');
  });

  it('stops civil-clock lighting updates while unlinked and relinks on demand', () => {
    expect(main).toContain('setLightingClockUnlinked(!lightingClockUnlinked)');
    expect(main).toContain('setLightingClockUnlinked(true)');
    expect(main).toContain('if (!lightingClockUnlinked)');
  });
});
