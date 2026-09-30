import { mat4, vec3 } from 'gl-matrix';
import { describe, expect, it } from 'vitest';
import {
  extractFrustumPlanes, sphereIntersectsFrustum, sphereIntersectsHorizontalWorldWindow, WORLD_COPY_INDICES, worldCopies,
} from '../src/rendering/visibility';
import { buildTerrainVisibility } from '../src/rendering/chunk-visibility';
import { StrategyCamera } from '../src/rendering/camera';
import type { WorldManifest } from '../src/rendering/types';

function createTestFrustum(): Float32Array {
  const projection = mat4.create();
  const view = mat4.create();
  const viewProjection = mat4.create();
  mat4.perspectiveZO(projection, Math.PI / 2, 1, 2, 100);
  mat4.lookAt(view, vec3.fromValues(0, 0, 0), vec3.fromValues(0, 0, -1), vec3.fromValues(0, 1, 0));
  mat4.multiply(viewProjection, projection, view);
  return extractFrustumPlanes(viewProjection);
}

describe('world visibility', () => {
  it('always considers the previous, current, and next wrapped world', () => {
    expect(WORLD_COPY_INDICES).toEqual([0, 1, 2]);
    expect(worldCopies(true)).toEqual([0, 1, 2]);
  });

  it('renders only the center copy for a non-wrapping map', () => {
    const manifest = {
      world: { width: 1_000, height: 500, wrapX: false },
      terrain: { chunksX: 2, chunksY: 1 },
    } as WorldManifest;
    const visibility = buildTerrainVisibility(manifest, [500, 1_000, 250], () => 0, () => true);
    expect(worldCopies(false)).toEqual([1]);
    expect(Array.from(visibility.instances)).toEqual([2, 3]);
  });

  it('clamps the Europe camera while preserving world wrapping', () => {
    const camera = new StrategyCamera();
    camera.configureWorld(1_000, 500, false);
    camera.target[0] = 2_000;
    camera.target[2] = -1_000;
    camera.update(0);
    expect(Array.from(camera.target)).toEqual([1_250, 0, -250]);
    camera.configureWorld(1_000, 500, true);
    camera.target[0] = 2_000;
    camera.update(0);
    expect(camera.target[0]).toBe(0);
  });

  it('moves the fog-backed horizontal visibility window with the camera target', () => {
    const worldWidth = 1_000;
    expect(sphereIntersectsHorizontalWorldWindow(-900, 0, 0, worldWidth)).toBe(true);
    expect(sphereIntersectsHorizontalWorldWindow(-990, 0, 0, worldWidth)).toBe(false);
    expect(sphereIntersectsHorizontalWorldWindow(10, 0, 1_000, worldWidth)).toBe(false);
    expect(sphereIntersectsHorizontalWorldWindow(20, 0, 990, worldWidth)).toBe(true);
    // Bounds crossing the fully fogged limit remain conservative.
    expect(sphereIntersectsHorizontalWorldWindow(-990, 10, 0, worldWidth)).toBe(true);
  });

  it('keeps a chunk that crosses the near plane even when its center is too close', () => {
    const planes = createTestFrustum();
    expect(sphereIntersectsFrustum(planes, 0, 0, -1, 2)).toBe(true);
  });

  it('keeps a chunk intersecting a side plane', () => {
    const planes = createTestFrustum();
    // At z=-10 the right plane is at approximately x=10. The center is
    // outside, but the sphere still overlaps the visible volume.
    expect(sphereIntersectsFrustum(planes, 11, 0, -10, 2)).toBe(true);
  });

  it('rejects bounded chunks wholly outside the camera frustum', () => {
    const planes = createTestFrustum();
    expect(sphereIntersectsFrustum(planes, 0, 0, 5, 0.5)).toBe(false);
    expect(sphereIntersectsFrustum(planes, 20, 0, -10, 1)).toBe(false);
    expect(sphereIntersectsFrustum(planes, 0, 0, -110, 1)).toBe(false);
  });
});
