import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const menu = readFileSync(path.join(root, 'src/menu/menu.ts'), 'utf8');
const audio = readFileSync(path.join(root, 'src/audio/audio-manager.ts'), 'utf8');
const main = readFileSync(path.join(root, 'src/main.ts'), 'utf8');

describe('menu interaction stability', () => {
  it('keeps dossier animation compositor-only', () => {
    const start = menu.indexOf('function update(t: number)');
    const end = menu.indexOf('async function playTransition', start);
    const update = menu.slice(start, end);

    expect(update).toContain('translate3d');
    expect(update).not.toContain('backgroundPosition');
    expect(update).not.toContain('style.filter');
  });

  it('does not install a second menu pointerdown audio unlock handler', () => {
    expect(menu).not.toContain("root.addEventListener('pointerdown'");
  });

  it('serializes concurrent AudioContext activation attempts', () => {
    expect(audio).toContain('private unlockInFlight?: Promise<boolean>');
    expect(audio).toContain('if (this.unlockInFlight) return this.unlockInFlight');
  });

  it('does not activate audio from passive hover before unlock', () => {
    expect(audio).toContain("if (cue === 'hover' && !this.unlocked) return");
  });

  it('keeps refresh audio recovery available until a real activation succeeds', () => {
    expect(main).toContain("document.addEventListener('pointerdown', recoverAudioAfterGesture, { capture: true })");
    expect(main).toContain("document.addEventListener('keydown', recoverAudioAfterGesture, { capture: true })");
    expect(main).not.toContain("recoverAudioAfterGesture, { capture: true, once: true }");
    expect(main).toContain("if (!await audio.unlock()) return");
    expect(main).toContain("await music.setState('menu', { force: true })");
  });

  it('does not report music as audible while its AudioContext is suspended', () => {
    const start = audio.indexOf('isMusicPlaying(): boolean');
    const end = audio.indexOf('setVolume(', start);
    const method = audio.slice(start, end);
    expect(method).toContain("this.context?.state === 'running'");
  });
});
