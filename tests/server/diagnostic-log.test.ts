import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DiagnosticLog } from '../../apps/game-server/src/diagnostic-log';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('diagnostic JSONL log', () => {
  it('serializes writes and rotates a bounded current file', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ironfronts-diagnostics-'));
    directories.push(directory);
    const filePath = path.join(directory, 'diagnostics.jsonl');
    const log = new DiagnosticLog(filePath, 300);
    for (let index = 0; index < 8; index++) {
      log.write('info', 'game-server', 'sample', { index, detail: 'x'.repeat(30) });
    }
    await log.flush();
    const current = await readFile(filePath, 'utf8');
    const previous = await readFile(`${filePath}.1`, 'utf8');
    for (const line of `${previous}${current}`.trim().split('\n')) expect(() => JSON.parse(line)).not.toThrow();
    expect(current).toContain('"source":"game-server"');
  });
});
