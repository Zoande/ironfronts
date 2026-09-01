import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const menu = readFileSync(path.join(root, 'src/menu/menu.ts'), 'utf8');
const audio = readFileSync(path.join(root, 'src/audio/audio-manager.ts'), 'utf8');

describe('menu interaction stability', () => {
  it('drives the dossier transition from CSS, not a main-thread rAF loop', () => {
    // The rAF-driven choreography could freeze with the main thread; the
    // transition is now a plain CSS `transition` on the `.is-open` class that
    // runs on the compositor regardless of main-thread health.
    expect(menu).not.toContain("from './choreo'");
    expect(menu).not.toContain('requestAnimationFrame');
    const start = menu.indexOf('function playTransition(');
    const end = menu.indexOf('async function openDossier', start);
    const pt = menu.slice(start, end);
    expect(pt).toContain("page.classList.add('is-open')");
    expect(pt).toContain("addEventListener('transitionend'");
    expect(pt).toContain('setTimeout(finish'); // busy is released even if the event is missed
    // No forced layout read every open, no animating the desk / main screen.
    expect(pt).not.toContain('getBoundingClientRect');
    expect(pt).not.toContain('main.style');

    const css = readFileSync(path.join(root, 'src/menu/menu.css'), 'utf8');
    expect(css).toMatch(/\.ifm__subpage\s*\{[^}]*transition:\s*opacity/);
    expect(css).toContain('.ifm__subpage.is-open');
    // The full-viewport blend/filter layers that stalled the compositor are gone.
    expect(css).not.toContain('mix-blend-mode: overlay');
    expect(css).not.toMatch(/\.ifm__map\s*\{[^}]*filter:/);
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

  it('drives menu-card inertness from a class, not a strandable inline style', () => {
    // The old code set `main.style.pointerEvents = 'none'` in a transition
    // finally block and relied on close to undo it — a stuck transition left
    // the menu dead. State is now a class toggled with `openScreen`.
    expect(menu).not.toContain("main.style.pointerEvents");
    expect(menu).toContain("root.classList.add('is-dossier-open')");
    expect(menu).toContain("root.classList.remove('is-dossier-open')");
    const css = readFileSync(path.join(root, 'src/menu/menu.css'), 'utf8');
    expect(css).toMatch(/\.ifm\.is-dossier-open \.ifm__screen \{[^}]*pointer-events:\s*none/);
  });

  it('animates the desk/menu parallax with compositor-only CSS transitions', () => {
    const css = readFileSync(path.join(root, 'src/menu/menu.css'), 'utf8');
    // The desk pans down and the main screen eases up+out when a dossier opens —
    // pure CSS `transition: transform`, no rAF, no filters/blend layers.
    expect(css).toMatch(/\.ifm__map \{[^}]*transition:\s*transform/);
    expect(css).toMatch(/\.ifm\.is-dossier-open \.ifm__map \{[^}]*translate3d/);
    expect(css).toMatch(/\.ifm\.is-dossier-open \.ifm__screen \{[^}]*translate3d/);
    // no expensive full-viewport paint hazards crept back in
    expect(css).not.toContain('mix-blend-mode: overlay');
    expect(css).not.toMatch(/\.ifm__map \{[^}]*filter:/);
    expect(menu).not.toContain('requestAnimationFrame');
  });

  it('provides a hard reset to the main screen for an abandoned launch', () => {
    const start = menu.indexOf('function resetToMainScreen()');
    const end = menu.indexOf('\n  }', start);
    const reset = menu.slice(start, end);
    expect(reset).toContain('busy = false');
    expect(reset).toContain("root.classList.remove('is-dossier-open', 'is-transitioning')");
    // Drops the crossfade state so the dossier can't come back half-open.
    expect(reset).toContain("page.classList.remove('is-open')");
    // launch() calls it when onLaunch rejects (Return to Command).
    const launchBody = menu.slice(menu.indexOf('async function launch('), menu.indexOf('async function deploy('));
    expect(launchBody).toContain('catch (error)');
    expect(launchBody).toContain('resetToMainScreen();');
  });

  it('will not start a launch while a menu transition is animating', () => {
    const start = menu.indexOf('async function deploy(');
    const end = menu.indexOf('\n  }', start);
    expect(menu.slice(start, end)).toContain('if (busy) return');
  });
});
