import { afterEach, describe, expect, it, vi } from 'vitest';
import { configureWorldAssetBase, fetchWorldBinary, verifyWorldDescriptor } from '../../src/rendering/world-assets';

const required = ['world.json', 'province-details.json', 'province-owners.u32', 'province-ids.u16', 'surface.rgba8', 'height.f32', 'connections.f32', 'road-network.json', 'road-centerlines.f32'];
const hex = (bytes: ArrayBuffer): string => [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
const sha = async (value: ArrayBuffer | Uint8Array): Promise<string> =>
  hex(await crypto.subtle.digest('SHA-256', value as BufferSource));

afterEach(() => vi.unstubAllGlobals());

describe('world package identity', () => {
  it('accepts only a complete descriptor whose aggregate identity matches', async () => {
    const artifactHashes = Object.fromEntries(required.map((name, index) => [name, String(index).padStart(64, '0')]));
    const sorted = Object.fromEntries(Object.entries(artifactHashes).sort(([a], [b]) => a.localeCompare(b)));
    const hash = await sha(new TextEncoder().encode(JSON.stringify(sorted)));
    await expect(verifyWorldDescriptor({ version: '12', hash, assetBaseUrl: 'https://world', artifactHashes })).resolves.toBeUndefined();
    await expect(verifyWorldDescriptor({ version: '12', hash: 'f'.repeat(64), assetBaseUrl: 'https://world', artifactHashes })).rejects.toThrow(/identity/);
    const incomplete = { ...artifactHashes }; delete incomplete['connections.f32'];
    await expect(verifyWorldDescriptor({ version: '12', hash, assetBaseUrl: 'https://world', artifactHashes: incomplete })).rejects.toThrow(/every gameplay/);
  });

  it('rejects downloaded bytes that do not match the announced artifact hash', async () => {
    const expected = await sha(new TextEncoder().encode('expected'));
    configureWorldAssetBase('https://world', { 'connections.f32': expected });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('tampered')));
    await expect(fetchWorldBinary('connections.f32')).rejects.toThrow(/artifact mismatch/);
  });
});
