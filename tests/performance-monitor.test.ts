import { describe, expect, it } from 'vitest';
import { createEmptyRenderWorkload, PerformanceMonitor } from '../src/rendering/performance-monitor';

describe('PerformanceMonitor', () => {
  it('reports frame percentiles, phase costs, GPU timing, and workload', () => {
    const monitor = new PerformanceMonitor(true);
    const workload = createEmptyRenderWorkload(14);
    workload.drawCalls = 9;
    workload.triangles = 12_345;
    workload.trianglesByCategory.trees = 10_000;
    for (let index = 1; index <= 100; index += 1) {
      monitor.record({
        frameMs: index,
        mainThreadMs: index / 2,
        phases: { camera: 0.1, uniforms: 0.2, labels: 0.3, pickRaycast: 0.35, hoverUi: 0.05, render: index / 3 },
      }, workload);
    }
    monitor.recordGpu(4.25);

    const snapshot = monitor.snapshot();
    expect(snapshot.sampleCount).toBe(100);
    expect(snapshot.frame.average).toBeCloseTo(50.5);
    expect(snapshot.frame.median).toBe(50);
    expect(snapshot.frame.p95).toBe(95);
    expect(snapshot.frame.p99).toBe(99);
    expect(snapshot.mainThread.average).toBeCloseTo(25.25);
    expect(snapshot.phases.render.p95).toBeCloseTo(95 / 3);
    expect(snapshot.gpu?.average).toBe(4.25);
    expect(snapshot.gpuSampleCount).toBe(1);
    expect(snapshot.workload.labels).toBe(14);
    expect(snapshot.workload.trianglesByCategory.trees).toBe(10_000);
  });

  it('bounds its history and resets timing without losing the latest workload', () => {
    const monitor = new PerformanceMonitor(false, 3);
    const workload = createEmptyRenderWorkload(2);
    for (const frameMs of [10, 20, 30, 40]) {
      monitor.record({
        frameMs,
        mainThreadMs: 1,
        phases: { camera: 0, uniforms: 0, labels: 0, pickRaycast: 0, hoverUi: 0, render: 1 },
      }, workload);
    }
    expect(monitor.snapshot().frame.average).toBe(30);
    monitor.reset();
    const snapshot = monitor.snapshot();
    expect(snapshot.sampleCount).toBe(0);
    expect(snapshot.gpu).toBeNull();
    expect(snapshot.gpuSampleCount).toBe(0);
    expect(snapshot.workload.labels).toBe(2);
  });
});
