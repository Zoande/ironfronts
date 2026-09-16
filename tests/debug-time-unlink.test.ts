import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const main = readFileSync(path.join(root, 'src/app/bootstrap.ts'), 'utf8');

describe('debug visual clock link', () => {
  it('offers one combined date/time and timezone section', () => {
    expect(html).toContain('id="debug-datetime"');
    expect(html).toContain('id="debug-time-link"');
    expect(html).toContain('aria-pressed="false"');
  });

  it('sets visual time authoritatively without gating sunlight locally', () => {
    expect(main).toContain("Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'");
    expect(main).toContain('session.setDevClock(shifted.getTime() - offsetMs)');
    expect(main).toContain('renderer.setTimeOfDay(clock.hour + clock.minute / 60');
  });
});
