import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const main = readFileSync(path.join(root, 'src/main.ts'), 'utf8');
const audio = readFileSync(path.join(root, 'src/audio/audio-manager.ts'), 'utf8');
const styles = readFileSync(path.join(root, 'src/styles.css'), 'utf8');
const html = readFileSync(path.join(root, 'index.html'), 'utf8');

/**
 * Regression coverage for the reload/Continue lockout: `onLaunch` used to
 * `await music.setState('opening')` before touching the renderer/connection,
 * and `AudioManager.unlock()` could leave `unlockInFlight` permanently pending
 * after a suspended-context resume() that never settles. Combined with a
 * `.loading` rule that ignored the `hidden` attribute, the player was left
 * staring at a frozen loading screen with no way out.
 */
describe('reload / Continue lockout', () => {
  describe('audio never gates game entry', () => {
    it('does not await any audio operation on the launch path', () => {
      // The opening soundtrack is fire-and-forget.
      expect(main).toMatch(/void music\.setState\('opening'\)\.catch/);
      expect(main).not.toContain("await music.setState('opening')");
      // Nothing on the entry path awaits audio unlock / playback.
      expect(main).not.toMatch(/await audio\.unlock\(\)[^;]*;[\s\S]{0,400}runLaunch/);
    });

    it('keeps the gesture-based audio recovery listeners attached (not once)', () => {
      expect(main).toContain("document.addEventListener('pointerdown', recoverAudioAfterGesture, { capture: true })");
      expect(main).toContain("document.addEventListener('keydown', recoverAudioAfterGesture, { capture: true })");
      expect(main).not.toContain('recoverAudioAfterGesture, { capture: true, once: true }');
    });

    it('recovers the CURRENT musical state on a later gesture, not always menu', () => {
      const start = main.indexOf('const recoverAudioAfterGesture');
      const end = main.indexOf('document.addEventListener(\'pointerdown\', recoverAudioAfterGesture', start);
      const body = main.slice(start, end);
      expect(body).toContain('music.resyncPlayback()');
      expect(body).toContain('audioActivationInFlight'); // re-entrancy guard
    });
  });

  describe('AudioManager.unlock() cannot be poisoned', () => {
    const start = audio.indexOf('async unlock(): Promise<boolean>');
    const end = audio.indexOf('\n  }', start) + 4;
    const unlock = audio.slice(start, end);

    it('re-checks the real context state instead of trusting a stale attempt', () => {
      expect(unlock).toContain("context.state === 'running'");
      // A running context short-circuits and clears any in-flight attempt.
      expect(unlock).toMatch(/context\.state === 'running'[\s\S]{0,200}this\.unlockInFlight = undefined/);
    });

    it('bounds a suspended-context resume() so it cannot pend forever', () => {
      expect(unlock).toContain('Promise.race');
      expect(unlock).toMatch(/setTimeout\(resolve, 2_?000\)/);
    });

    it('always clears unlockInFlight in a finally block', () => {
      expect(unlock).toMatch(/finally\s*\{\s*this\.unlockInFlight = undefined;/);
    });
  });

  describe('isMusicPlaying reflects real audibility', () => {
    it('requires a running AudioContext, not just an unpaused element', () => {
      const start = audio.indexOf('isMusicPlaying(): boolean');
      const end = audio.indexOf('\n  }', start);
      expect(audio.slice(start, end)).toContain("this.context?.state === 'running'");
    });
  });

  describe('background-tab soundtrack', () => {
    it('does not suspend the AudioContext when the tab is hidden', () => {
      const start = audio.indexOf('installLifecycle(');
      const end = audio.indexOf('\n  }', start);
      const lifecycle = audio.slice(start, end);
      expect(lifecycle).not.toContain('context.suspend()');
      // It still re-asserts a running context when the tab returns.
      expect(lifecycle).toContain('context.resume()');
    });
  });

  describe('the loading overlay honours `hidden`', () => {
    it('has a .loading[hidden] { display: none } rule', () => {
      expect(styles).toMatch(/\.loading\[hidden\]\s*\{\s*display:\s*none;?\s*\}/);
    });

    it('ships a launch-failure panel with Retry and Return to Command', () => {
      expect(html).toContain('id="loading-error"');
      expect(html).toContain('id="loading-retry"');
      expect(html).toContain('id="loading-return"');
    });

    it('paints an opaque base so it never flashes the blue :root behind it', () => {
      // The loader has no image until desk-scene.jpg decodes; without an opaque
      // background the blue `:root` (and the just-revealed brand) show through.
      expect(styles).toMatch(/\.loading\s*\{[^}]*\bbackground:\s*#060807\b[^}]*\}/);
    });

    it('fills in the Field Note and first stage before unhiding the loader', () => {
      const start = main.indexOf('async function runLaunch(');
      const body = main.slice(start, main.indexOf('\n}', start));
      const quoteAt = body.indexOf('startLoadingQuotes()');
      const stageAt = body.indexOf("setLoadingStage('Connecting to command server'");
      const showAt = body.indexOf('showLoader()');
      expect(quoteAt).toBeGreaterThan(-1);
      expect(showAt).toBeGreaterThan(-1);
      expect(quoteAt).toBeLessThan(showAt);
      expect(stageAt).toBeLessThan(showAt);
    });
  });

  describe('launch lifecycle is fully guarded', () => {
    it('time-bounds every awaited launch step', () => {
      expect(main).toContain('function withTimeout<T>(');
      expect(main).toMatch(/withTimeout\(\s*joinGame/);
      expect(main).toMatch(/withTimeout\(\s*\n?\s*GameConnection\.open/);
      expect(main).toMatch(/withTimeout\(import\('\.\/renderer'\)/);
      expect(main).toMatch(/withTimeout\(\s*\n?\s*renderer\.initialize/);
      expect(main).toMatch(/withTimeout\(bootstrapGameSession/);
    });

    it('routes any launch failure to the error state, not an infinite loader', () => {
      const start = main.indexOf('async function runLaunch(');
      const end = main.indexOf('\n}', start);
      const runLaunch = main.slice(start, end);
      expect(runLaunch).toContain('catch (error)');
      expect(runLaunch).toContain('teardownPartialLaunch()');
      expect(runLaunch).toContain('showLaunchError(');
    });

    it('Retry re-runs the launch after cleaning up the partial attempt', () => {
      expect(main).toMatch(/loadingRetry\.addEventListener\('click'[\s\S]{0,200}runLaunch\(/);
      const teardownStart = main.indexOf('async function teardownPartialLaunch');
      const teardownEnd = main.indexOf('\n}', teardownStart);
      const teardown = main.slice(teardownStart, teardownEnd);
      expect(teardown).toContain('activeConnection?.close()');
      expect(teardown).toContain('activeRenderer?.dispose()');
      expect(teardown).toContain('launchDisposers.splice(0)');
    });

    it('Return to Command restores the menu and frees rendererStarted', () => {
      const start = main.indexOf("loadingReturn.addEventListener('click'");
      const handler = main.slice(start, start + 900);
      expect(handler).toContain('teardownPartialLaunch()');
      expect(handler).toContain('rendererStarted = false');
      expect(handler).toContain('.reject(');
    });

    it('settles the launch promise on the no-WebGPU terminal path', () => {
      const start = main.indexOf('if (!navigator.gpu)');
      const block = main.slice(start, start + 500);
      expect(block).toContain('launchOutcome?.resolve()');
      expect(block).toContain('launchOutcome = null');
    });

    it('cancels stale loader-hide timers before a retry can show the loader again', () => {
      expect(main).toContain('let loaderHideTimer: number | undefined');
      expect(main).toContain('function cancelLoaderHide(): void');
      const showStart = main.indexOf('function showLoader(): void');
      const show = main.slice(showStart, showStart + 350);
      expect(show).toContain('cancelLoaderHide()');
    });

    it('aborts renderer-attempt DOM listeners during teardown', () => {
      const start = main.indexOf('const attemptEvents = new AbortController()');
      const setup = main.slice(start, start + 400);
      expect(setup).toContain('launchDisposers.push(() => attemptEvents.abort())');
      expect(setup).toContain('const attemptListener = { signal: attemptEvents.signal }');
      // The renderer-scoped debug listeners opt into the attempt's AbortSignal.
      expect(main).toContain("debugToggle.addEventListener('click', toggleDiagnostics, attemptListener)");
      expect(main).toMatch(/window\.addEventListener\('keydown', \(event\) => \{[\s\S]{0,700}\}, attemptListener\);/);
    });
  });
});
