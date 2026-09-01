import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  path.join(process.cwd(), 'src/client/game-connection.ts'),
  'utf8',
);

describe('game connection startup cleanup', () => {
  it('settles and closes a pre-baseline socket on timeout', () => {
    expect(source).toContain("settleError(new Error('Game connection timed out.')");
    expect(source).toContain("socket.close(closeCode ?? 1000");
  });

  it('rejects a socket that closes before the baseline arrives', () => {
    expect(source).toContain("Game connection closed before the battlefield state arrived.");
  });

  it('rejects malformed server messages before ready instead of waiting for timeout', () => {
    expect(source).toContain("Invalid response from game server:");
    expect(source).toContain("1002, 'Invalid server message'");
  });

  it('keeps post-baseline connection errors non-fatal to the startup promise', () => {
    expect(source).toContain("this.dispatchEvent(new CustomEvent('connection-error'");
  });
});
