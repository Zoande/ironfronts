import type { Mesh } from './scene-meshes';
import type { PropChunkRange, WorldManifest } from './types';
import { WORLD_COPY_INDICES } from './visibility';

export interface TerrainVisibility {
  instances: Uint32Array;
  draws: Array<{ firstInstance: number; instanceCount: number; lod: number }>;
}

export interface PropVisibility {
  instances: Uint32Array;
  draws: Array<{ mesh: Mesh; firstInstance: number; instanceCount: number; lod: number }>;
  visibleChunks: number;
}

export function buildTerrainVisibility(
  manifest: WorldManifest,
  cameraPosition: ArrayLike<number>,
  sampleHeight: (x: number, z: number) => number,
  intersectsView: (centerX: number, centerZ: number, radius: number) => boolean,
  lodScale = 1,
): TerrainVisibility {
  const chunksX = manifest.terrain.chunksX;
  const chunksY = manifest.terrain.chunksY;
  const chunksPerWorld = chunksX * chunksY;
  const chunkWidth = manifest.world.width / chunksX;
  const chunkHeight = manifest.world.height / chunksY;
  const chunkRadius = Math.hypot(chunkWidth, chunkHeight) * 0.72;
  const lodEntries: number[][] = [[], [], [], []];
  for (const copy of WORLD_COPY_INDICES) {
    const copyOffset = (copy - 1) * manifest.world.width;
    for (let chunkY = 0; chunkY < chunksY; chunkY += 1) {
      for (let chunkX = 0; chunkX < chunksX; chunkX += 1) {
        const centerX = (chunkX + 0.5) * chunkWidth + copyOffset;
        const centerZ = (chunkY + 0.5) * chunkHeight;
        const centerY = sampleHeight(centerX, centerZ);
        const distance = Math.hypot(
          centerX - cameraPosition[0], centerY - cameraPosition[1], centerZ - cameraPosition[2],
        );
        if (!intersectsView(centerX, centerZ, chunkRadius)) continue;
        const lod = distance < 1_050 * lodScale ? 0
          : distance < 2_350 * lodScale ? 1
          : distance < 5_000 * lodScale ? 2 : 3;
        lodEntries[lod].push(copy * chunksPerWorld + chunkY * chunksX + chunkX);
      }
    }
  }
  const instances = new Uint32Array(lodEntries.reduce((sum, entries) => sum + entries.length, 0));
  const draws: TerrainVisibility['draws'] = [];
  let cursor = 0;
  for (let lod = 0; lod < lodEntries.length; lod += 1) {
    const entries = lodEntries[lod];
    if (!entries.length) continue;
    instances.set(entries, cursor);
    draws.push({ firstInstance: cursor, instanceCount: entries.length, lod });
    cursor += entries.length;
  }
  return { instances, draws };
}

export function buildPropVisibility(
  manifest: WorldManifest,
  ranges: PropChunkRange[],
  groupMeshes: Mesh[][],
  layerCount: number,
  cameraPosition: ArrayLike<number>,
  maximumDistance: number,
  lodDistances: [number, number],
  intersectsView: (centerX: number, centerZ: number, radius: number) => boolean,
): PropVisibility {
  const chunksX = manifest.propChunks.chunksX;
  const chunksY = manifest.propChunks.chunksY;
  const chunkWidth = manifest.world.width / chunksX;
  const chunkHeight = manifest.world.height / chunksY;
  const chunkRadius = Math.hypot(chunkWidth, chunkHeight) * 0.55;
  const buckets = groupMeshes.map((meshes) => meshes.map(() => [] as number[]));
  let visibleChunks = 0;
  for (const copy of WORLD_COPY_INDICES) {
    const copyOffset = (copy - 1) * manifest.world.width;
    for (let chunkIndex = 0; chunkIndex < ranges.length; chunkIndex += 1) {
      const range = ranges[chunkIndex];
      if (!range?.instanceCount) continue;
      const centerX = (chunkIndex % chunksX + 0.5) * chunkWidth + copyOffset;
      const centerZ = (Math.floor(chunkIndex / chunksX) + 0.5) * chunkHeight;
      const distance = Math.hypot(
        centerX - cameraPosition[0], centerZ - cameraPosition[2], cameraPosition[1],
      );
      if (distance > maximumDistance + chunkRadius || !intersectsView(centerX, centerZ, chunkRadius)) continue;
      visibleChunks += 1;
      const lod = distance < lodDistances[0] ? 0 : distance < lodDistances[1] ? 1 : 2;
      const groups = groupMeshes.length === 1 ? [range] : range.groups;
      for (let group = 0; group < groups.length; group += 1) {
        const groupRange = groups[group];
        if (!groupRange?.instanceCount) continue;
        const meshGroup = Math.min(group, groupMeshes.length - 1);
        const meshLod = Math.min(lod, groupMeshes[meshGroup].length - 1);
        const bucket = buckets[meshGroup][meshLod];
        for (let index = 0; index < groupRange.instanceCount; index += 1) {
          bucket.push(copy * layerCount + groupRange.firstInstance + index);
        }
      }
    }
  }
  const instances = new Uint32Array(buckets.flat(2).length);
  const draws: PropVisibility['draws'] = [];
  let cursor = 0;
  for (let group = 0; group < buckets.length; group += 1) {
    for (let lod = 0; lod < buckets[group].length; lod += 1) {
      const bucket = buckets[group][lod];
      if (!bucket.length) continue;
      instances.set(bucket, cursor);
      draws.push({ mesh: groupMeshes[group][lod], firstInstance: cursor, instanceCount: bucket.length, lod });
      cursor += bucket.length;
    }
  }
  return { instances, draws, visibleChunks };
}

/**
 * Hard visible-instance budget. When a frame's culled prop set still exceeds
 * `budget`, keep a stride-sampled subset within every draw (so each LOD /
 * mesh group is thinned proportionally and the spatial spread is preserved).
 * This is real submitted-instance reduction, not a shader-side fade.
 */
export function capVisibleInstances(visibility: PropVisibility, budget: number): PropVisibility {
  const total = visibility.instances.length;
  if (!Number.isFinite(budget) || total <= budget || total === 0) return visibility;

  const keepRatio = budget / total;
  const kept: number[] = [];
  const draws: PropVisibility['draws'] = [];
  for (const draw of visibility.draws) {
    const target = Math.max(1, Math.round(draw.instanceCount * keepRatio));
    const stride = draw.instanceCount / target;
    const firstInstance = kept.length;
    for (let step = 0; step < target; step += 1) {
      const local = Math.min(draw.instanceCount - 1, Math.floor(step * stride));
      kept.push(visibility.instances[draw.firstInstance + local]);
    }
    draws.push({
      mesh: draw.mesh,
      lod: draw.lod,
      firstInstance,
      instanceCount: kept.length - firstInstance,
    });
  }
  return { instances: Uint32Array.from(kept), draws, visibleChunks: visibility.visibleChunks };
}
