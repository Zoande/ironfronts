import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const renderer = readFileSync(path.join(process.cwd(), 'src/renderer.ts'), 'utf8');

describe('background-tab render suspension', () => {
  it('skips the frame body while the tab is hidden but keeps the rAF loop alive', () => {
    const frameStart = renderer.indexOf('private frame = (time: number)');
    const body = renderer.slice(frameStart, frameStart + 600);
    expect(body).toContain('if (this.renderingSuspended)');
    // still reschedules so returning to the tab resumes instantly, no reload
    expect(body).toMatch(/if \(this\.renderingSuspended\)[\s\S]{0,200}requestAnimationFrame\(this\.frame\)/);
    // and bails before any render/pick/uniform work
    expect(body.indexOf('if (this.renderingSuspended)')).toBeLessThan(body.indexOf('const frameStarted'));
  });

  it('drives suspension from visibilitychange and resets the frame clock on resume', () => {
    expect(renderer).toContain("document.addEventListener('visibilitychange', this.onVisibilityChange");
    const handler = renderer.slice(renderer.indexOf('private onVisibilityChange'), renderer.indexOf('private frame ='));
    expect(handler).toContain('this.renderingSuspended = document.hidden');
    expect(handler).toContain('this.previousTime = performance.now()');
  });

  it('registers the listener against the interaction AbortController so it is cleaned up', () => {
    const attach = renderer.slice(renderer.indexOf('private attachRuntimeBindings'), renderer.indexOf('private detachRuntimeBindings'));
    expect(attach).toMatch(/visibilitychange[\s\S]{0,120}signal: this\.interactionAbort\.signal/);
  });
});
