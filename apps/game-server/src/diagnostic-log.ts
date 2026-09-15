import { appendFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';

export type DiagnosticLevel = 'debug' | 'info' | 'warn' | 'error';

/** Serialized, bounded JSONL diagnostics shared by the server and browser. */
export class DiagnosticLog {
  private queue = Promise.resolve();
  private approximateBytes = 0;
  private disabled = false;

  constructor(
    readonly filePath?: string,
    private readonly maxBytes = 10 * 1024 * 1024,
  ) {}

  write(level: DiagnosticLevel, source: 'game-server' | 'browser', event: string,
    fields: Record<string, unknown> = {}): void {
    const filePath = this.filePath;
    if (!filePath || this.disabled) return;
    const record = JSON.stringify({
      ...fields, timestamp: new Date().toISOString(), level, source, event,
    }) + '\n';
    this.queue = this.queue.then(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      if (this.approximateBytes === 0) {
        this.approximateBytes = await stat(filePath).then((value) => value.size).catch(() => 0);
      }
      if (this.approximateBytes + Buffer.byteLength(record) > this.maxBytes) {
        const previousPath = `${filePath}.1`;
        await unlink(previousPath).catch(() => undefined);
        await rename(filePath, previousPath).catch(() => undefined);
        this.approximateBytes = 0;
      }
      await appendFile(filePath, record, 'utf8');
      this.approximateBytes += Buffer.byteLength(record);
    }).catch((error) => {
      // Report a broken optional destination once, then stop retrying every
      // health sample or browser event.
      this.disabled = true;
      console.error('[diagnostic-log] write failed', error);
    });
  }

  async flush(): Promise<void> { await this.queue; }
}
