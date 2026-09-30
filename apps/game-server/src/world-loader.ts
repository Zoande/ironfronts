import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildWorldData, type WorldData } from '@ironfronts/game-core';

async function arrayBuffer(directory: string, name: string): Promise<ArrayBuffer> {
  const buffer = await readFile(path.join(directory, name));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

export async function loadWorld(directory: string): Promise<{ world: WorldData; version: string; hash: string; legacyHash: string; artifactHashes: Record<string, string> }> {
  const manifestBytes = await readFile(path.join(directory, 'world.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const expectedUrls = {
    provinceDetails: manifest.sidecars?.provinceDetails?.url,
    owners: manifest.politics?.owners?.url,
    ids: manifest.fields?.provinceIds?.url,
    surface: manifest.fields?.surface?.url,
    height: manifest.fields?.height?.url,
    connections: manifest.buffers?.connections?.url,
    roadNetwork: manifest.sidecars?.roadNetwork?.url,
    roadCenterlines: manifest.buffers?.roadCenterlines?.url,
  };
  const canonical = ['province-details.json', 'province-owners.u32', 'province-ids.u16', 'surface.rgba8', 'height.f32', 'connections.f32', 'road-network.json', 'road-centerlines.f32'];
  if (Object.values(expectedUrls).some((url, index) => String(url).replace(/^\//, '') !== canonical[index])) {
    throw new Error('World manifest points gameplay data outside its identified package.');
  }
  const details = JSON.parse(await readFile(path.join(directory, 'province-details.json'), 'utf8')).provinces;
  const roadNetwork = JSON.parse(await readFile(path.join(directory, 'road-network.json'), 'utf8'));
  const [owners, ids, surface, connections, roadCenterlines] = await Promise.all([
    arrayBuffer(directory, 'province-owners.u32'),
    arrayBuffer(directory, 'province-ids.u16'),
    arrayBuffer(directory, 'surface.rgba8'),
    arrayBuffer(directory, 'connections.f32'),
    arrayBuffer(directory, 'road-centerlines.f32'),
  ]);
  const artifactNames = ['world.json', 'province-details.json', 'province-owners.u32', 'province-ids.u16', 'surface.rgba8', 'height.f32', 'connections.f32', 'road-network.json', 'road-centerlines.f32'];
  const artifactHashes = Object.fromEntries(await Promise.all(artifactNames.sort().map(async (name) => [name,
    createHash('sha256').update(await readFile(path.join(directory, name))).digest('hex')])));
  return {
    world: buildWorldData({
      worldWidth: manifest.world.width,
      worldHeight: manifest.world.height,
      provinceDetails: details,
      countries: manifest.politics.countries,
      provinceOwners: new Uint32Array(owners),
      provinceIdRaster: new Uint16Array(ids),
      provinceIdField: manifest.fields.provinceIds,
      surface: new Uint8Array(surface),
      surfaceField: manifest.fields.surface,
      connections: new Float32Array(connections),
      roadNetwork: { ...roadNetwork, centerlines: new Float32Array(roadCenterlines) },
      resourceNodes: [],
    }),
    version: String(manifest.version),
    legacyHash: createHash('sha256').update(manifestBytes).digest('hex'),
    artifactHashes,
    hash: createHash('sha256').update(JSON.stringify(artifactHashes)).digest('hex'),
  };
}
