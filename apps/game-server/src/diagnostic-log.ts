import { appendFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

/** Serialized, bounded JSONL diagnostics shared by the server and browser. */
export class DiagnosticLog {
  private queue = Promise.resolve();
  private approximateBytes = 0;

  constructor(
    readonly filePath: string,
    private readonly maxBytes = 10 * 1024 * 1024,
  ) {}

  write(level: DiagnosticLevel, source: 'game-server' | 'browser', event: string,
    fields: Record<string, unknown> = {}): void {
    const record = JSON.stringify({
      ...fields, timestamp: new Date().toISOString(), level, source, event,
    }) + '\n';
    this.queue = this.queue.then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      if (this.approximateBytes === 0) {
        this.approximateBytes = await stat(this.filePath).then((value) => value.size).catch(() => 0);
      }
      if (this.approximateBytes + Buffer.byteLength(record) > this.maxBytes) {
        const previousPath = `${this.filePath}.1`;
        await unlink(previousPath).catch(() => undefined);
        await rename(this.filePath, previousPath).catch(() => undefined);
        this.approximateBytes = 0;
      }
      await appendFile(this.filePath, record, 'utf8');
      this.approximateBytes += Buffer.byteLength(record);
    }).catch((error) => {
      // The console remains available if the diagnostic destination fails.
      console.error('[diagnostic-log] write failed', error);
    });
  }

  async flush(): Promise<void> { await this.queue; }
}
