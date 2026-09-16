/**
 * Visual resource-deposit layer (first pass).
 *
 * Deterministic, geography-driven placement of stone / metal / oil deposits,
 * generated once from the already-loaded terrain fields — no extra fetch, no
 * build-pipeline change, no per-frame work. This is a *visual* layer only:
 * nothing here feeds economy or production.
 *
 * Rendering is currently a screen-space marker overlay (see game-ui.ts),
 * shown only when the player enables the resource overlay and only at
 * regional / close zoom. Real 3D deposit props at close zoom are a
 * documented next step (needs a new instanced prop pipeline + LOD budget).
 */

import type { BinaryField } from './types';

export type ResourceKind = 'stone' | 'metal' | 'oil';

export interface ResourceNode {
  readonly id: number;
  readonly kind: ResourceKind;
  /** World-space position (same space as camera target / props). */
  readonly x: number;
  readonly z: number;
  /** Terrain height sampled at (x, z). */
  readonly y: number;
  /**
   * Deposit quantity in abstract strategic units — how much of the mineral the
   * ground holds, NOT a production/day rate. Deterministic from position.
   * Ranges: stone 40–300, metal 20–180, oil 50–500.
   */
  readonly amount: number;
  /** `amount` mapped to 0..1 within its kind's range (marker sizing / tint). */
  readonly richness: number;
}

/** Per-kind deposit-quantity range (abstract strategic units, not per-day). */
export const RESOURCE_AMOUNT_RANGE: Record<ResourceKind, readonly [number, number]> = {
  stone: [40, 300],
  metal: [20, 180],
  oil: [50, 500],
};

/**
 * Deposit quantities aggregated over every resource node inside one province.
 * Precomputed once at renderer init and looked up by province id — the tooltip
 * / province card never scans the node list.
 */
export interface ProvinceResources {
  readonly stone: number;
  readonly metal: number;
  readonly oil: number;
}

/** Sum deposit `amount` per kind for each province a node falls in. */
export function aggregateProvinceResources(
  nodes: readonly ResourceNode[],
  provinceOf: (x: number, z: number) => number,
): Map<number, ProvinceResources> {
  const totals = new Map<number, { stone: number; metal: number; oil: number }>();
  for (const node of nodes) {
    const provinceId = provinceOf(node.x, node.z);
    if (!provinceId) continue;
    let entry = totals.get(provinceId);
    if (!entry) {
      entry = { stone: 0, metal: 0, oil: 0 };
      totals.set(provinceId, entry);
    }
    entry[node.kind] += node.amount;
  }
  return totals as Map<number, ProvinceResources>;
}

export interface ResourceFieldInput {
  /** rgba8 surface field: channel 0 = terrain class (0 ord,1 hill,2 mtn,3 forest,4 urban), channel 3 = 0 for water/void. */
  readonly surface: Uint8Array;
  readonly surfaceField: BinaryField;
  /** r32float height field. */
  readonly height: Float32Array;
  readonly heightField: BinaryField;
  readonly world: { readonly width: number; readonly height: number };
}

// Deterministic caps so the overlay never becomes clutter.
const CAP: Record<ResourceKind, number> = { stone: 1400, metal: 360, oil: 24 };
const GRID_STEP = 6; // surface texels between placement samples
const SEED = 0x1f2e3d4c;

function hash2(gx: number, gy: number): number {
  let h = (Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663) ^ SEED) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h / 0xffffffff;
}

/** Deterministic deposit quantity for a node, from a position hash. */
function depositAmount(kind: ResourceKind, x: number, z: number): { amount: number; richness: number } {
  const [lo, hi] = RESOURCE_AMOUNT_RANGE[kind];
  // Bias the distribution toward the low end so rich deposits stay uncommon.
  const raw = hash2(Math.round(x * 0.5) | 0, (Math.round(z * 0.5) | 0) ^ 0x51ed);
  const richness = raw * raw;
  return { amount: Math.round(lo + (hi - lo) * richness), richness };
}

function sampleHeight(input: ResourceFieldInput, x: number, z: number): number {
  const f = input.heightField;
  const px = ((Math.floor(x / input.world.width * f.width) % f.width) + f.width) % f.width;
  const pz = Math.min(f.height - 1, Math.max(0, Math.floor(z / input.world.height * f.height)));
  return input.height[pz * f.width + px] ?? 0;
}

/**
 * @returns deposits ordered stone, then metal, then oil (stable).
 */
export function generateResourceNodes(input: ResourceFieldInput): ResourceNode[] {
  const { surface, surfaceField: sf, world } = input;
  const nodes: ResourceNode[] = [];
  const counts: Record<ResourceKind, number> = { stone: 0, metal: 0, oil: 0 };
  let id = 1;

  const emit = (kind: ResourceKind, x: number, z: number): void => {
    if (counts[kind] >= CAP[kind]) return;
    const wx = ((x % world.width) + world.width) % world.width;
    const wz = Math.min(world.height, Math.max(0, z));
    const { amount, richness } = depositAmount(kind, wx, wz);
    nodes.push({ id: id++, kind, x: wx, z: wz, y: sampleHeight(input, wx, wz), amount, richness });
    counts[kind] += 1;
  };

  // Two passes keep the output grouped by kind without a sort.
  for (const pass of ['clustered', 'oil'] as const) {
    for (let gy = 0; gy < sf.height; gy += GRID_STEP) {
      for (let gx = 0; gx < sf.width; gx += GRID_STEP) {
        const o = (gy * sf.width + gx) * 4;
        if (surface[o + 3] === 0) continue; // water / void
        const cls = surface[o];
        const biome = surface[o + 1];
        const worldX = (gx + 0.5) / sf.width * world.width;
        const worldZ = (gy + 0.5) / sf.height * world.height;
        const r = hash2(gx, gy);

        if (pass === 'clustered') {
          // Stone favours rocky ground; metal is a rarer, mountain-biased subset.
          let stoneChance = 0;
          let metalChance = 0;
          if (cls === 2) { stoneChance = 0.020; metalChance = 0.008; }       // mountains
          else if (cls === 1) { stoneChance = 0.006; metalChance = 0.0022; } // hills
          if (r < metalChance) {
            emitCluster(emit, 'metal', worldX, worldZ, r, 2);
          } else if (r < stoneChance) {
            emitCluster(emit, 'stone', worldX, worldZ, r, cls === 2 ? 4 : 3);
          }
        } else {
          // Oil: very rare, lowland, biased to dry / desert biomes, never in cities.
          if (cls === 0 && (biome === 1 || biome === 2) && r > 0.99960) {
            emit('oil', worldX, worldZ);
          }
        }
      }
    }
  }
  return nodes;
}

function emitCluster(
  emit: (k: ResourceKind, x: number, z: number) => void,
  kind: ResourceKind,
  x: number,
  z: number,
  seed: number,
  size: number,
): void {
  emit(kind, x, z);
  for (let i = 1; i < size; i += 1) {
    const a = (seed * 997 + i * 2.399963) % (Math.PI * 2);
    const d = 26 + ((seed * 131 + i * 53) % 44);
    emit(kind, x + Math.cos(a) * d, z + Math.sin(a) * d * 0.8);
  }
}
