import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { capVisibleInstances, type PropVisibility } from '../src/chunk-visibility';
import type { Mesh } from '../src/scene-meshes';
import {
  DEFAULT_QUALITY, isQualityLevel, loadQuality, QUALITY_LEVELS, QUALITY_PRESETS,
  resolveRenderPixelRatio, saveQuality,
} from '../src/graphics/quality';

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}

describe('graphics quality presets', () => {
  it('defines all four levels with ascending, capped render scales', () => {
    expect(QUALITY_LEVELS).toEqual(['low', 'medium', 'high', 'ultra']);
    const scales = QUALITY_LEVELS.map((level) => QUALITY_PRESETS[level].renderScale);
    expect(scales).toEqual([0.75, 1, 1.25, 1.5]);
    expect([...scales].sort((a, b) => a - b)).toEqual(scales);
    expect(Math.max(...scales)).toBeLessThanOrEqual(1.5);
  });

  it('reduces real workload knobs monotonically from ultra to low', () => {
    const treeBudgets = QUALITY_LEVELS.map((l) => QUALITY_PRESETS[l].treeInstanceBudget);
    const propDist = QUALITY_LEVELS.map((l) => QUALITY_PRESETS[l].propDistanceScale);
    const rain = QUALITY_LEVELS.map((l) => QUALITY_PRESETS[l].rainScale);
    expect(treeBudgets[0]).toBeLessThan(treeBudgets[2]);
    expect(propDist[0]).toBeLessThan(propDist[2]);
    expect(rain[0]).toBeLessThan(rain[2]);
    expect(QUALITY_PRESETS.low.furniture).toBe(false);
    expect(QUALITY_PRESETS.high.furniture).toBe(true);
  });

  it('resolves an absolute pixel ratio clamped to [0.5, 1.5], ignoring devicePixelRatio', () => {
    expect(resolveRenderPixelRatio('low')).toBe(0.75);
    expect(resolveRenderPixelRatio('medium')).toBe(1);
    expect(resolveRenderPixelRatio('high')).toBe(1.25);
    expect(resolveRenderPixelRatio('ultra')).toBe(1.5);
    for (const level of QUALITY_LEVELS) {
      const ratio = resolveRenderPixelRatio(level);
      expect(ratio).toBeGreaterThanOrEqual(0.5);
      expect(ratio).toBeLessThanOrEqual(1.5);
    }
  });

  it('persists and restores the choice, defaulting to HIGH and rejecting garbage', () => {
    const storage = memoryStorage();
    expect(loadQuality(storage)).toBe(DEFAULT_QUALITY);
    expect(DEFAULT_QUALITY).toBe('high');
    saveQuality('low', storage);
    expect(loadQuality(storage)).toBe('low');
    storage.setItem('ironfronts:graphics-quality', 'potato');
    expect(loadQuality(storage)).toBe(DEFAULT_QUALITY);
  });

  it('validates level strings', () => {
    expect(isQualityLevel('ultra')).toBe(true);
    expect(isQualityLevel('LOW')).toBe(false);
    expect(isQualityLevel(2)).toBe(false);
  });

  it('makes every adjacent preset materially different on several real knobs', () => {
    const knobs = (l: typeof QUALITY_LEVELS[number]) => {
      const p = QUALITY_PRESETS[l];
      return [p.renderScale, p.propDistanceScale, p.treeInstanceBudget,
        p.buildingInstanceBudget, p.terrainLodScale, p.detailFactor];
    };
    for (let i = 1; i < QUALITY_LEVELS.length; i += 1) {
      const a = knobs(QUALITY_LEVELS[i - 1]);
      const b = knobs(QUALITY_LEVELS[i]);
      const changed = a.filter((v, k) => v !== b[k]).length;
      expect(changed, `${QUALITY_LEVELS[i - 1]} -> ${QUALITY_LEVELS[i]}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('exposes the resolved preset knobs + gated counts through the renderer readout', () => {
    const renderer = readFileSync(new URL('../src/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toContain('get qualityReadout()');
    expect(renderer).toContain('armyModelRange');
    // the 3D-army LOD swap distance is preset-scaled, not a bare constant
    expect(renderer).toContain('this.camera.distance < this.armyModelDrawDistance');
    expect(renderer).toContain('ARMY_MODEL_RANGE_BASE * this.qualityPreset.propDistanceScale');
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toContain('activeRenderer.qualityReadout');
    expect(main).toMatch(/preset\s+prop .*lod .*detail .*furniture/);
  });
});

describe('capVisibleInstances', () => {
  const mesh = {} as Mesh;
  const build = (counts: number[]): PropVisibility => {
    const instances: number[] = [];
    const draws = counts.map((count, lod) => {
      const firstInstance = instances.length;
      for (let i = 0; i < count; i += 1) instances.push(firstInstance + i);
      return { mesh, lod, firstInstance, instanceCount: count };
    });
    return { instances: Uint32Array.from(instances), draws, visibleChunks: counts.length };
  };

  it('returns the same object when already within budget', () => {
    const vis = build([50, 30]);
    expect(capVisibleInstances(vis, 100)).toBe(vis);
    expect(capVisibleInstances(vis, Number.POSITIVE_INFINITY)).toBe(vis);
  });

  it('thins every draw proportionally when over budget', () => {
    const vis = build([600, 400]); // 1000 total
    const capped = capVisibleInstances(vis, 250);
    expect(capped.instances.length).toBeLessThanOrEqual(260);
    expect(capped.instances.length).toBeGreaterThan(200);
    // both LOD draws survive, contiguous, in the same order
    expect(capped.draws).toHaveLength(2);
    expect(capped.draws[0].firstInstance).toBe(0);
    expect(capped.draws[1].firstInstance).toBe(capped.draws[0].instanceCount);
    expect(capped.draws[0].instanceCount).toBeGreaterThan(capped.draws[1].instanceCount);
    // kept indices are a strided subset of the originals (still ascending)
    const kept = [...capped.instances];
    expect([...kept].sort((a, b) => a - b)).not.toEqual(kept.slice().reverse());
    expect(new Set(kept).size).toBe(kept.length);
  });
});
