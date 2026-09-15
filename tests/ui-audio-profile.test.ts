import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const audioManager = readFileSync(
  path.join(process.cwd(), 'src/audio/engine/audio-manager.ts'),
  'utf8',
);

describe('war-room UI audio profile', () => {
  // 'select' gained a purpose-built army-select sample in a later, deliberate
  // pass ("feat(audio): add 0ad tactical sound cues") — a real RTS
  // unit-selection bark, not the generic bright menu chirp this test was
  // originally guarding against. Hover and confirm still hold the line.
  it('keeps hover and operation confirmation off bright sampled chirps', () => {
    const mappings = audioManager.slice(
      audioManager.indexOf('const UI_SAMPLE_URLS'),
      audioManager.indexOf('const AMBIENCE_CONFIG'),
    );

    expect(mappings).not.toContain("hover:");
    expect(mappings).not.toContain("confirm:");
  });

  it('uses low mechanical synthesized cues for campaign interaction', () => {
    expect(audioManager).toContain("this.playTone(uiGain, 126, 104");
    expect(audioManager).toContain("this.playTone(uiGain, 118, 76");
    expect(audioManager).toContain("this.playTone(uiGain, 104, 68");
  });
});
