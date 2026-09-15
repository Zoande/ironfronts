import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalDiagnosticsPath = process.env.DIAGNOSTICS_PATH;

afterEach(() => {
  if (originalDiagnosticsPath === undefined) delete process.env.DIAGNOSTICS_PATH;
  else process.env.DIAGNOSTICS_PATH = originalDiagnosticsPath;
  vi.resetModules();
});

describe('game server diagnostics configuration', () => {
  it('disables file diagnostics when DIAGNOSTICS_PATH is absent or blank', async () => {
    delete process.env.DIAGNOSTICS_PATH;
    vi.resetModules();
    expect((await import('../../apps/game-server/src/config')).config.diagnosticsPath).toBeUndefined();

    process.env.DIAGNOSTICS_PATH = '   ';
    vi.resetModules();
    expect((await import('../../apps/game-server/src/config')).config.diagnosticsPath).toBeUndefined();
  });

  it('resolves an explicitly configured diagnostics destination', async () => {
    process.env.DIAGNOSTICS_PATH = 'data/local-diagnostics.jsonl';
    vi.resetModules();
    expect((await import('../../apps/game-server/src/config')).config.diagnosticsPath)
      .toBe(path.resolve(process.cwd(), 'data/local-diagnostics.jsonl'));
  });
});
