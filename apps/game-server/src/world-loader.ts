import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { buildWorldData, type WorldData } from '@ironfronts/game-core';

async function arrayBuffer(file: string): Promise<ArrayBuffer> {
  const buffer = await readFile(file);
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function assetName(value: unknown, fallback?: string): string | undefined {
  const name = typeof value === 'string' && value.length > 0 ? value : fallback;
  if (!name) return undefined;
  if (path.isAbsolute(name) || path.basename(name) !== name || name.includes(String.fromCharCode(92)) || name.includes(':') || name === '.' || name === '..') {
    throw new Error('World manifest points gameplay data outside its identified package.');
  }
  return name;
}

export async function loadWorld(directory: string): Promise<{ world: WorldData; version: string; hash: string; legacyHash: string; artifactHashes: Record<string, string> }> {
  const packageDirectory = await realpath(directory);
  const manifestBytes = await readFile(path.join(packageDirectory, 'world.json'));
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const resolveAsset = async (name: string): Promise<string> => {
    const resolved = await realpath(path.join(packageDirectory, name));
    if (!resolved.startsWith(packageDirectory + path.sep)) {
      throw new Error('World manifest points gameplay data outside its identified package.');
    }
    return resolved;
  };
  const readAsset = async (name: string): Promise<Buffer> => readFile(await resolveAsset(name));
  const mandatory = {
    details: assetName(manifest.sidecars?.provinceDetails?.url, 'province-details.json')!,
    owners: assetName(manifest.sidecars?.owners?.url, 'province-owners.u32')!,
    ids: assetName(manifest.fields?.provinceIds?.url, 'province-ids.u16')!,
    surface: assetName(manifest.fields?.surface?.url, 'surface.rgba8')!,
    height: assetName(manifest.fields?.height?.url, 'height.f32')!,
    connections: assetName(manifest.buffers?.connections?.url, 'connections.f32')!,
  };
  const roadNetworkName = assetName(manifest.sidecars?.roadNetwork?.url);
  const roadCenterlinesName = assetName(manifest.buffers?.roadCenterlines?.url);
  const details = JSON.parse((await readAsset(mandatory.details)).toString('utf8')).provinces;
  const roadNetwork = roadNetworkName
    ? JSON.parse((await readAsset(roadNetworkName)).toString('utf8'))
    : undefined;
  const [owners, ids, surface, connections, roadCenterlines] = await Promise.all([
    arrayBuffer(await resolveAsset(mandatory.owners)),
    arrayBuffer(await resolveAsset(mandatory.ids)),
    arrayBuffer(await resolveAsset(mandatory.surface)),
    arrayBuffer(await resolveAsset(mandatory.connections)),
    roadCenterlinesName ? arrayBuffer(await resolveAsset(roadCenterlinesName)) : Promise.resolve(new ArrayBuffer(0)),
  ]);
  const artifactNames = [
    'world.json',
    ...Object.values(mandatory),
    ...(roadNetworkName ? [roadNetworkName] : []),
    ...(roadCenterlinesName ? [roadCenterlinesName] : []),
  ].sort();
  const artifactHashes = Object.fromEntries(await Promise.all(artifactNames.map(async (name) => [
    name,
    createHash('sha256').update(await readAsset(name)).digest('hex'),
  ])));
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
      ...(roadNetwork ? { roadNetwork: { ...roadNetwork, centerlines: new Float32Array(roadCenterlines) } } : {}),
      resourceNodes: [],
    }),
    version: String(manifest.version),
    legacyHash: createHash('sha256').update(manifestBytes).digest('hex'),
    artifactHashes,
    hash: createHash('sha256').update(JSON.stringify(artifactHashes)).digest('hex'),
  };
}
