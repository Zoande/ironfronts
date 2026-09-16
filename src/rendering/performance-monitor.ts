export interface PerformanceDistribution {
  average: number;
  median: number;
  p95: number;
  p99: number;
  maximum: number;
}

export interface PerformancePhases {
  camera: number;
  uniforms: number;
  labels: number;
  pickRaycast: number;
  hoverUi: number;
  render: number;
}

export type RenderCategory = 'terrain' | 'water' | 'waterways' | 'roads' | 'hiddenLinks'
  | 'polarCaps' | 'trees' | 'buildings' | 'roadFurniture' | 'weather' | 'borders' | 'debugLines' | 'labels';

export interface RenderWorkload {
  drawCalls: number;
  triangles: number;
  instances: number;
  labels: number;
  visibleChunks: { terrain: number; trees: number; buildings: number; roadFurniture: number; roads: number; hiddenLinks: number; waterways: number; borders: number };
  lodInstances: { terrain: number[]; trees: number[]; buildings: number[] };
  trianglesByCategory: Record<RenderCategory, number>;
}

export interface FramePerformanceSample {
  frameMs: number;
  mainThreadMs: number;
  phases: PerformancePhases;
}

export interface PerformanceSnapshot {
  sampleCount: number;
  frame: PerformanceDistribution;
  mainThread: PerformanceDistribution;
  phases: Record<keyof PerformancePhases, PerformanceDistribution>;
  gpu: PerformanceDistribution | null;
  gpuSampleCount: number;
  gpuTimingSupported: boolean;
  workload: RenderWorkload;
}

const EMPTY_DISTRIBUTION: PerformanceDistribution = {
  average: 0,
  median: 0,
  p95: 0,
  p99: 0,
  maximum: 0,
};

const PHASE_KEYS = ['camera', 'uniforms', 'labels', 'pickRaycast', 'hoverUi', 'render'] as const;

export class PerformanceMonitor {
  private readonly samples: FramePerformanceSample[] = [];
  private readonly gpuSamples: number[] = [];
  private latestWorkload = createEmptyRenderWorkload();
  // Rolling sums kept in lockstep with the ring buffers above so `average` is
  // an O(1) lookup at snapshot time instead of an extra full reduce() over up
  // to `maximumSamples` entries for each of the 8 distributions below — the
  // sort those still need for exact percentiles is the one cost left.
  private frameSum = 0;
  private mainThreadSum = 0;
  private readonly phaseSums: PerformancePhases = { camera: 0, uniforms: 0, labels: 0, pickRaycast: 0, hoverUi: 0, render: 0 };
  private gpuSum = 0;

  constructor(
    private readonly gpuTimingSupported: boolean,
    private readonly maximumSamples = 600,
  ) {}

  record(sample: FramePerformanceSample, workload: RenderWorkload): void {
    this.samples.push(sample);
    this.frameSum += sample.frameMs;
    this.mainThreadSum += sample.mainThreadMs;
    for (const phase of PHASE_KEYS) this.phaseSums[phase] += sample.phases[phase];
    if (this.samples.length > this.maximumSamples) {
      const removed = this.samples.shift()!;
      this.frameSum -= removed.frameMs;
      this.mainThreadSum -= removed.mainThreadMs;
      for (const phase of PHASE_KEYS) this.phaseSums[phase] -= removed.phases[phase];
    }
    this.latestWorkload = workload;
  }

  recordGpu(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    this.gpuSamples.push(milliseconds);
    this.gpuSum += milliseconds;
    if (this.gpuSamples.length > this.maximumSamples) this.gpuSum -= this.gpuSamples.shift()!;
  }

  reset(): void {
    this.samples.length = 0;
    this.gpuSamples.length = 0;
    this.frameSum = 0;
    this.mainThreadSum = 0;
    this.gpuSum = 0;
    for (const phase of PHASE_KEYS) this.phaseSums[phase] = 0;
  }

  snapshot(): PerformanceSnapshot {
    const phases = {} as Record<keyof PerformancePhases, PerformanceDistribution>;
    for (const phase of PHASE_KEYS) {
      phases[phase] = distribution(this.samples.map((sample) => sample.phases[phase]), this.phaseSums[phase]);
    }
    return {
      sampleCount: this.samples.length,
      frame: distribution(this.samples.map((sample) => sample.frameMs), this.frameSum),
      mainThread: distribution(this.samples.map((sample) => sample.mainThreadMs), this.mainThreadSum),
      phases,
      gpu: this.gpuSamples.length ? distribution(this.gpuSamples, this.gpuSum) : null,
      gpuSampleCount: this.gpuSamples.length,
      gpuTimingSupported: this.gpuTimingSupported,
      workload: cloneWorkload(this.latestWorkload),
    };
  }
}

export function createEmptyRenderWorkload(labels = 0): RenderWorkload {
  return {
    drawCalls: 0,
    triangles: 0,
    instances: 0,
    labels,
    visibleChunks: { terrain: 0, trees: 0, buildings: 0, roadFurniture: 0, roads: 0, hiddenLinks: 0, waterways: 0, borders: 0 },
    lodInstances: { terrain: [0, 0, 0, 0], trees: [0, 0, 0], buildings: [0, 0, 0] },
    trianglesByCategory: {
      terrain: 0,
      water: 0,
      waterways: 0,
      polarCaps: 0,
      roads: 0,
      hiddenLinks: 0,
      trees: 0,
      buildings: 0,
      roadFurniture: 0,
      weather: 0,
      borders: 0,
      debugLines: 0,
      labels: 0,
    },
  };
}

function distribution(values: number[], sum: number): PerformanceDistribution {
  if (!values.length) return { ...EMPTY_DISTRIBUTION };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    average: sum / values.length,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    maximum: sorted[sorted.length - 1],
  };
}

function percentile(sorted: number[], fraction: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1))];
}

function cloneWorkload(workload: RenderWorkload): RenderWorkload {
  return {
    ...workload,
    visibleChunks: { ...workload.visibleChunks },
    lodInstances: {
      terrain: [...workload.lodInstances.terrain],
      trees: [...workload.lodInstances.trees],
      buildings: [...workload.lodInstances.buildings],
    },
    trianglesByCategory: { ...workload.trianglesByCategory },
  };
}
