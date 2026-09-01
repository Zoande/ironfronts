import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const iconsSrc = readFileSync(path.join(root, 'src/ui/icons.ts'), 'utf8');
const credits = readFileSync(path.join(root, 'docs/ASSET_CREDITS.md'), 'utf8');

/** Every `png('stem')` / `png('sub/stem')` call must resolve to a vendored file. */
function referenced0adStems(): string[] {
  return [...iconsSrc.matchAll(/\bpng\('([^']+)'\)/g)].map((m) => m[1]);
}

describe('0 A.D. asset provenance', () => {
  it('every 0 A.D. icon the registry references exists on disk', () => {
    const stems = [...new Set(referenced0adStems())];
    expect(stems.length).toBeGreaterThan(15); // we actually use a real set now
    for (const stem of stems) {
      const file = path.join(root, 'src/ui/assets/icons/0ad', `${stem}.png`);
      expect(existsSync(file), `${stem}.png missing`).toBe(true);
    }
  });

  it('every referenced 0 A.D. icon is credited in ASSET_CREDITS.md', () => {
    for (const stem of new Set(referenced0adStems())) {
      const leaf = `${stem.split('/').pop()}.png`;
      expect(credits.includes(leaf), `${leaf} not credited`).toBe(true);
    }
  });

  it('credits the vendored cursors and the interface alert sound with their upstream paths', () => {
    for (const cursor of ['action-attack.png', 'cursor-no.png', 'cursor-rally.png']) {
      expect(existsSync(path.join(root, 'public/cursors', cursor)), `${cursor} missing`).toBe(true);
      expect(credits).toContain(`cursors/${cursor}`);
    }
    expect(existsSync(path.join(root, 'public/audio/sfx/alarmattackunit_1.ogg'))).toBe(true);
    expect(credits).toContain('audio/interface/alarm/alarmattackunit_1.ogg');
    expect(credits).toMatch(/audio\/LICENSE\.txt/);
  });

  it('names the CC BY-SA 3.0 licence and the share-alike obligation', () => {
    expect(credits).toContain('CC BY-SA 3.0');
    expect(credits).toMatch(/share-alike/i);
  });
});
