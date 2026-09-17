/**
 * Pure builder: raw world buffers -> `WorldData`.
 *
 * Shared by `main.ts` (feeding GameSession from the loaded world package) and
 * the test harness, so the encoded-id / raster-sampling gotchas live in exactly
 * one place. No renderer, no DOM, no fetch — the caller supplies the bytes.
 */

import type {
  CanonicalRoadNetwork, TerrainClass, WorldCountry, WorldData, WorldProvince, WorldResourceNode,
} from './world-data';
import { TERRAIN_CLASS } from './world-data';
import { wrapX } from './geometry';

export interface FieldDescriptor {
  readonly width: number;
  readonly height: number;
}

export interface WorldDataInputs {
  readonly worldWidth: number;
  readonly worldHeight: number;
  /** province-details.json `provinces` array. */
  readonly provinceDetails: ReadonlyArray<{
    id: number;
    center: readonly [number, number];
    terrainId: number;
    population: number;
    coastal: boolean;
  }>;
  /** world.json `politics.countries`. */
  readonly countries: ReadonlyArray<{
    id: number; name: string; color: string; capitalProvinceId: number;
  }>;
  /** province-owners.u32 — indexed by ENCODED id (raw province_id + 1). */
  readonly provinceOwners: Uint32Array;
  /** province-ids.u16 raster — values are ENCODED id (0 = water/void). */
  readonly provinceIdRaster: Uint16Array;
  readonly provinceIdField: FieldDescriptor;
  /** surface.rgba8 — channel 0 = terrain class, channel 3 = 0 for water/void. */
  readonly surface: Uint8Array;
  readonly surfaceField: FieldDescriptor;
  /** connections.f32 (stride 8), retained for sea/ferry links. */
  readonly connections: Float32Array;
  readonly roadNetwork?: CanonicalRoadNetwork;
  /** Deterministic resource deposits (from generateResourceNodes). */
  readonly resourceNodes: readonly WorldResourceNode[];
}

export function buildWorldData(input: WorldDataInputs): WorldData {
  const {
    worldWidth: width, worldHeight: height, provinceIdRaster, provinceIdField,
    surface, surfaceField, provinceOwners,
  } = input;

  const sampleTexel = (field: FieldDescriptor, x: number, z: number): number => {
    const px = Math.min(
      field.width - 1,
      Math.floor(wrapX(x, width) / width * field.width),
    );
    const pz = Math.min(
      field.height - 1,
      Math.max(0, Math.floor(z / height * field.height)),
    );
    return pz * field.width + px;
  };

  const provinceAt = (x: number, z: number): number => {
    const encoded = provinceIdRaster[sampleTexel(provinceIdField, x, z)] ?? 0;
    return encoded > 0 ? encoded - 1 : -1;
  };

  const terrainClassAt = (x: number, z: number): TerrainClass => {
    const base = sampleTexel(surfaceField, x, z) * 4;
    if ((surface[base + 3] ?? 0) === 0) return TERRAIN_CLASS.water;
    return (surface[base] ?? 0) as TerrainClass;
  };

  const provinces: WorldProvince[] = input.provinceDetails.map((detail) => ({
    id: detail.id,
    center: [detail.center[0], detail.center[1]] as const,
    terrainId: detail.terrainId,
    population: detail.population,
    coastal: detail.coastal,
    urban: terrainClassAt(detail.center[0], detail.center[1]) === TERRAIN_CLASS.urban,
  }));

  const countries: WorldCountry[] = input.countries.map((country) => ({
    id: country.id,
    name: country.name,
    color: country.color,
    capitalProvinceId: country.capitalProvinceId,
  }));

  return {
    width,
    height,
    provinces,
    countries,
    provinceOwner: (provinceId: number) => provinceOwners[provinceId + 1] ?? 0,
    provinceAt,
    terrainClassAt,
    connections: input.connections,
    roadNetwork: input.roadNetwork,
    resourceNodes: input.resourceNodes,
  };
}
