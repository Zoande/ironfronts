/**
 * Shared test helper: assemble a `WorldData` from the built world output on
 * disk (public/world/**). `pretest` runs `build:world`, so these files exist
 * whenever the suite runs. Uses the same pure builder as `main.ts`.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { WorldData } from '../../src/game/world-data';
import { buildWorldData } from '../../src/game/world-data-loader';
import { generateResourceNodes } from '../../src/rendering/resource-nodes';

const WORLD_DIR = path.resolve(__dirname, '../../public/world');

async function bin(name: string): Promise<ArrayBuffer> {
  const buffer = await readFile(path.join(WORLD_DIR, name));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

export interface LoadedWorld extends WorldData {
  readonly countryByName: (name: string) => { id: number; capitalProvinceId: number } | undefined;
}

export async function loadWorld(): Promise<LoadedWorld> {
  const manifest = JSON.parse(await readFile(path.join(WORLD_DIR, 'world.json'), 'utf8'));
  const details = JSON.parse(
    await readFile(path.join(WORLD_DIR, 'province-details.json'), 'utf8'),
  ).provinces;

  const surface = new Uint8Array(await bin('surface.rgba8'));
  const height = new Float32Array(await bin('height.f32'));
  const worldWidth: number = manifest.world.width;
  const worldHeight: number = manifest.world.height;

  const resourceNodes = generateResourceNodes({
    surface,
    surfaceField: manifest.fields.surface,
    height,
    heightField: manifest.fields.height,
    world: { width: worldWidth, height: worldHeight },
  }).map((node) => ({ id: node.id, kind: node.kind, x: node.x, z: node.z, amount: node.amount }));

  const world = buildWorldData({
    worldWidth,
    worldHeight,
    provinceDetails: details,
    countries: manifest.politics.countries,
    provinceOwners: new Uint32Array(await bin('province-owners.u32')),
    provinceIdRaster: new Uint16Array(await bin('province-ids.u16')),
    provinceIdField: manifest.fields.provinceIds,
    surface,
    surfaceField: manifest.fields.surface,
    connections: new Float32Array(await bin('connections.f32')),
    resourceNodes,
  });

  return {
    ...world,
    countryByName: (name: string) => world.countries.find(
      (country) => country.name.toLowerCase() === name.toLowerCase(),
    ),
  };
}
