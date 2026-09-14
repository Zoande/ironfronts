import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const gameUi = readFileSync(path.join(process.cwd(), 'src/ui/game-ui.ts'), 'utf8');
const mainTs = readFileSync(path.join(process.cwd(), 'src/main.ts'), 'utf8');

describe('World Inspector unlock UI', () => {
  it('offers an entitled user a visible password unlock in the System menu', () => {
    expect(gameUi).toContain("'Unlock World Inspector'");
    expect(gameUi).toContain('state.debugUnlockAvailable || state.debugEnabled');
    expect(gameUi).toContain('actions.requestDebugAccess()');
    expect(mainTs).toContain("window.prompt('World Inspector password')");
    expect(mainTs).toContain('session.unlockDebug(password)');
  });

  it('does not install debug handles until the server grants access', () => {
    expect(mainTs).toContain('debugEnabled = session.debugEnabled');
    expect(mainTs).toContain('setDebugHandles(window as unknown as Record<string, unknown>, debugEnabled');
  });
});
