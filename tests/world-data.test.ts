import { describe, expect, it } from 'vitest';
import { access, readFile } from 'node:fs/promises';

interface Manifest {
  version: number;
  world: { width: number; height: number; wrapX: boolean };
  fields: Record<string, { url: string; width: number; height: number; format: string; mipLevelCount?: number }>;
  buffers: Record<string, { url: string; count: number; stride: number }>;
  terrain: { maxHeight: number };
  infrastructureChunks: {
    roads: Array<{ firstIndex: number; indexCount: number }>;
    hiddenConnections: Array<{ firstIndex: number; indexCount: number }>;
    waterways: Array<{ firstIndex: number; indexCount: number }>;
  };
  borderChunks: {
    chunksX: number;
    chunksY: number;
    ranges: Array<{ firstInstance: number; instanceCount: number }>;
  };
  counts: Record<string, number>;
  sidecars: { provinceDetails: { url: string; version: number }; roadNetwork: { url: string; version: number } };
  politics: {
    owners: { url: string; count: number; stride: number };
    adjacency: { url: string; count: number; stride: number };
    labelData: { url: string; count: number; stride: number };
    countries: Array<{
      id: number; name: string; color: string; colorFamily: number; capitalProvinceId: number;
    }>;
  };
  propChunks: {
    chunksX: number;
    chunksY: number;
    trees: PropChunkRange[];
    buildings: PropChunkRange[];
  };
  provinces: Array<{ id: number; name: string; terrain: string }>;
}

interface PropChunkRange {
  firstInstance: number;
  instanceCount: number;
  groups: Array<{ firstInstance: number; instanceCount: number }>;
}

async function manifest(): Promise<Manifest> {
  return JSON.parse(await readFile('public/world/world.json', 'utf8')) as Manifest;
}

function viewF32(bytes: Buffer): Float32Array {
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

function viewU32(bytes: Buffer): Uint32Array {
  return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

describe('generated v13 world package', () => {
  it('preserves the canonical world and exposes simplified roads plus supplied waterways', async () => {
    const data = await manifest();
    expect(data.version).toBe(13);
    expect(data.world).toEqual(expect.objectContaining({ width: 13_562, height: 7_000, wrapX: true }));
    expect(data.provinces).toHaveLength(3_303);
    expect(new Set(data.provinces.map((province) => province.id)).size).toBe(3_303);
    expect(data.provinces[0]).toEqual(expect.objectContaining({ id: 0, name: 'Las Palmas', terrain: 'Plains' }));
    expect(Object.keys(data.fields).sort()).toEqual(['coast', 'height', 'navigation', 'provinceIds', 'surface', 'terrainAlbedo', 'terrainNormal']);
    expect(data.fields.terrainNormal).toEqual(expect.objectContaining({ width: 2048, format: 'rg8snorm' }));
    expect(data.fields.terrainAlbedo).toEqual(expect.objectContaining({ width: 2048, format: 'rgba8unorm-srgb' }));
    expect(data.fields.terrainAlbedo.mipLevelCount).toBeGreaterThan(1);
    expect(data.sidecars.roadNetwork).toEqual({ url: 'road-network.json', version: 1 });
    expect(data.buffers.roadCenterlines).toEqual(expect.objectContaining({ url: 'road-centerlines.f32', stride: 2 }));
    const [normalBytes, albedoBytes, navigationBytes] = await Promise.all([
      readFile(`public/world/${data.fields.terrainNormal.url}`),
      readFile(`public/world/${data.fields.terrainAlbedo.url}`),
      readFile(`public/world/${data.fields.navigation.url}`),
    ]);
    expect(normalBytes.byteLength).toBe(data.fields.terrainNormal.width * data.fields.terrainNormal.height * 2);
    let mipWidth = data.fields.terrainAlbedo.width, mipHeight = data.fields.terrainAlbedo.height, albedoByteLength = 0;
    for (let level = 0; level < data.fields.terrainAlbedo.mipLevelCount!; level += 1) {
      albedoByteLength += mipWidth * mipHeight * 4;
      mipWidth = Math.max(1, Math.floor(mipWidth / 2));
      mipHeight = Math.max(1, Math.floor(mipHeight / 2));
    }
    expect(albedoBytes.byteLength).toBe(albedoByteLength);
    expect(albedoBytes.some((value, index) => index % 4 === 3 && value > 0 && value < 255)).toBe(true);
    expect(data.fields.navigation.format).toBe('rgba8unorm');
    expect(navigationBytes.byteLength).toBe(data.fields.navigation.width * data.fields.navigation.height * 4);
    expect(data.fields.coast.format).toBe('rg8unorm');
    const bankBytes = await readFile(`public/world/${data.fields.coast.url}`);
    expect(bankBytes.byteLength).toBe(data.fields.coast.width * data.fields.coast.height * 2);
    expect(bankBytes.some((value, index) => index % 2 === 1 && value > 0 && value < 255)).toBe(true);
    for (const obsolete of ['riverVertices', 'riverIndices', 'bridgeVertices', 'bridgeIndices', 'tunnelVertices', 'tunnelIndices', 'engineeringVertices', 'engineeringIndices']) {
      expect(data.buffers[obsolete]).toBeUndefined();
    }
    expect(data.buffers.roadVertices).toEqual(expect.objectContaining({ stride: 9 }));
    expect(data.buffers.hiddenConnectionVertices).toEqual(expect.objectContaining({ stride: 9 }));
    expect(data.buffers.waterwayVertices).toEqual(expect.objectContaining({ stride: 10 }));
    expect(data.buffers.waterwayIndices).toEqual(expect.objectContaining({ stride: 1 }));
    expect(data.borderChunks.ranges).toHaveLength(data.borderChunks.chunksX * data.borderChunks.chunksY);
    expect(data.borderChunks.ranges.reduce((sum, range) => sum + range.instanceCount, 0)).toBe(data.buffers.borders.count);
    const borderBytes = await readFile(`public/world/${data.buffers.borders.url}`);
    const borders = viewF32(borderBytes);
    expect(borders.length).toBe(data.buffers.borders.count * data.buffers.borders.stride);
    for (let border = 0; border < data.buffers.borders.count; border += 251) {
      expect(borders[border * 8 + 6]).toBeGreaterThanOrEqual(1);
      expect(borders[border * 8 + 7]).toBeGreaterThanOrEqual(0);
    }
    expect(data.provinces.every((province) => Object.keys(province).sort().join(',') === 'id,name,terrain')).toBe(true);
    const details = JSON.parse(await readFile(`public/world/${data.sidecars.provinceDetails.url}`, 'utf8'));
    expect(data.sidecars.provinceDetails.version).toBe(1);
    expect(details.version).toBe(1);
    expect(details.provinces).toHaveLength(data.provinces.length);
    expect(details.provinces[0]).toEqual(expect.objectContaining({ id: 0, center: expect.any(Array), population: expect.any(Number) }));
    for (const obsolete of ['corridorMetrics', 'corridorFlags', 'connectionCorridorOffsets', 'connectionCorridorIds']) {
      expect(data.buffers[obsolete]).toBeUndefined();
    }
  });

  it('packages stable canonical road edges whose lengths match their rendered centerlines', async () => {
    const data = await manifest();
    const network = JSON.parse(await readFile('public/world/road-network.json', 'utf8')) as {
      version: number;
      nodes: Array<{ id: number; x: number; z: number }>;
      edges: Array<{ id: number; from: number; to: number; length: number; pointOffset: number; pointCount: number; dotted: boolean }>;
    };
    const points = viewF32(await readFile('public/world/road-centerlines.f32'));
    expect(network.version).toBe(1);
    expect(network.edges).toHaveLength(data.counts.logicalRoads);
    expect(network.edges.filter((edge) => edge.dotted)).toHaveLength(data.counts.hiddenRoads);
    for (const [edgeIndex, edge] of network.edges.entries()) {
      expect(edge.id).toBe(edgeIndex);
      let measured = 0;
      for (let i = 1; i < edge.pointCount; i += 1) {
        const a = (edge.pointOffset + i - 1) * 2, b = (edge.pointOffset + i) * 2;
        let dx = points[b] - points[a];
        if (dx > data.world.width / 2) dx -= data.world.width;
        else if (dx < -data.world.width / 2) dx += data.world.width;
        measured += Math.hypot(dx, points[b + 1] - points[a + 1]);
      }
      expect(edge.length).toBeCloseTo(measured, 9);
      expect([points[edge.pointOffset * 2], points[edge.pointOffset * 2 + 1]])
        .toEqual([network.nodes[edge.from].x, network.nodes[edge.from].z]);
      const end = (edge.pointOffset + edge.pointCount - 1) * 2;
      expect([points[end], points[end + 1]])
        .toEqual([network.nodes[edge.to].x, network.nodes[edge.to].z]);
    }
  });

  it('reconstructs the authoritative river graph and both static ocean-water canals', async () => {
    const data = await manifest();
    const [vertexBytes, indexBytes, networkBytes, maskBytes, provinceIdBytes, heightBytes, nodeBytes, reportBytes] = await Promise.all([
      readFile('public/world/waterway-vertices.f32'), readFile('public/world/waterway-indices.u32'),
      readFile('public/world/waterway-network-lines.f32'),
      readFile('public/world/navigation.rgba8'),
      readFile('public/world/province-ids.u16'),
      readFile('public/world/height.f32'),
      readFile('material/movement/network_nodes.json', 'utf8'), readFile('public/world/world-generation-report.json', 'utf8'),
    ]);
    const vertices = viewF32(vertexBytes), indices = viewU32(indexBytes), network = viewF32(networkBytes);
    const heights = viewF32(heightBytes);
    const provinceIds = new Uint16Array(provinceIdBytes.buffer, provinceIdBytes.byteOffset, provinceIdBytes.byteLength / 2);
    const source = JSON.parse(nodeBytes) as { nodes: Array<{ kind: string; location_name: string }> };
    const report = JSON.parse(reportBytes);
    const riverNames = new Set(report.waterways.riverSystems);
    const sourceRiverPoints = source.nodes.filter((node) => node.kind === 'sea_point' && riverNames.has(node.location_name));
    const sourceCanalPoints = source.nodes.filter((node) => node.kind === 'sea_point' && ['Kiel Canal', 'Suez Channel'].includes(node.location_name));
    expect(report.version).toBe('world-generation-v13');
    expect(report.waterways.animatedSurface).toBe(true);
    expect(report.waterways.animation).toBe('simple-flow-aligned-shimmer');
    expect(report.waterways.terrainTreatment).toBe('shallow lower-only channel with guarded inner terrain clip and independently draped surface vertices');
    expect(report.waterways.terrainClipMask).toBe(true);
    expect(report.waterways.terrainOverlayMask).toBe(true);
    expect(report.waterways.minimumRiverWidth).toBeGreaterThanOrEqual(11);
    expect(report.waterways.crossSectionSamples).toBe(5);
    expect(report.waterways.nodeCapSegments).toBe(24);
    expect(report.waterways.surfaceLift).toBe(0.14);
    expect(report.waterways.canalSurface).toBe('static-water province-zero channel');
    expect(report.waterways.riverSystems).toHaveLength(24);
    expect(sourceRiverPoints).toHaveLength(520);
    expect(sourceCanalPoints).toHaveLength(8);
    expect(data.counts).toEqual(expect.objectContaining({
      riverSystems: 24, riverSourcePoints: 520, riverSegments: 527, riverMouthLinks: 29,
      canalSystems: 2, canalSourcePoints: 8, canalSegments: 10,
    }));
    expect(vertices.length).toBe(data.buffers.waterwayVertices.count * 10);
    expect(indices.length).toBe(data.buffers.waterwayIndices.count);
    expect(network.length).toBe(data.buffers.waterwayNetworkLines.count * 8);
    expect(data.buffers.waterwayNetworkLines.count).toBe(537);
    expect(network.every(Number.isFinite)).toBe(true);
    for (let line = 0; line < data.buffers.waterwayNetworkLines.count; line += 1) {
      const offset = line * 8;
      // A short river-mouth overlap may now sit slightly below the 0.42 ocean
      // surface as the shallow carved channel dissolves into open water.
      expect(network[offset + 4]).toBeGreaterThanOrEqual(0.079);
      expect(network[offset + 5]).toBeGreaterThanOrEqual(0.079);
      expect([0, 1]).toContain(network[offset + 6]);
    }
    expect(data.fields.navigation.format).toBe('rgba8unorm');
    expect(maskBytes.byteLength).toBe(data.fields.navigation.width * data.fields.navigation.height * 4);
    expect(maskBytes.some((value, index) => index % 4 === 2 && value > 0)).toBe(true);
    expect(maskBytes.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    expect(report.visualRivers.minimumRenderedWidth).toBeGreaterThanOrEqual(7.5);
    expect(report.visualRivers.minimumRenderedWidth).toBeLessThan(report.waterways.minimumRiverWidth);
    expect(report.waterways.visualSurface.meshSubdivisions).toBe(2);
    expect(report.waterways.visualSurface.maximumSampleSpacing).toBeLessThanOrEqual(1.7);
    expect(report.waterways.visualSurface.renderKind).toBe(0.25);
    expect(report.waterways.visualSurface.surfaceLift).toBe(0.14);
    expect(report.visualRivers.centerPixels).toBeGreaterThan(0);
    expect(report.visualRivers.widenedLandPixels).toBeGreaterThan(0);
    expect(data.counts.visualRiverComponents).toBeGreaterThan(0);
    expect(report.topography.riverCarving).toEqual(expect.objectContaining({
      method: 'shallow lower-only river channel with a short bank fade',
      depth: 0.35,
      fadeDistance: 14,
    }));
    expect(report.topography.riverCarving.adjustedCells).toBeGreaterThan(0);
    expect(report.banks.riverBankPixels).toBeGreaterThan(0);
    let widenedVisualLandPixels = 0;
    let movementVisualOverlap = 0;
    for (let pixel = 0; pixel < provinceIds.length; pixel += 1) {
      const movement = maskBytes[pixel * 4 + 2] / 255;
      const visual = maskBytes[pixel * 4 + 3] / 255;
      if (visual > 0.45 && provinceIds[pixel] !== 0) widenedVisualLandPixels += 1;
      if (movement > 0.45 && visual > 0.45) movementVisualOverlap += 1;
    }
    expect(widenedVisualLandPixels).toBeGreaterThan(0);
    expect(movementVisualOverlap).toBe(0);
    expect(vertices.every(Number.isFinite)).toBe(true);
    let centerVertices = 0;
    let drapedLandVertices = 0;
    const sampleTerrainHeight = (x: number, z: number) => {
      const width = data.fields.height.width, height = data.fields.height.height;
      const fx = ((x % data.world.width) + data.world.width) % data.world.width / data.world.width * width - 0.5;
      const fz = Math.max(0, Math.min(height - 1, z / data.world.height * height - 0.5));
      const x0raw = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0raw, tz = fz - z0;
      const x0 = ((x0raw % width) + width) % width, x1 = (x0 + 1) % width, z1 = Math.min(height - 1, z0 + 1);
      const top = heights[z0 * width + x0] * (1 - tx) + heights[z0 * width + x1] * tx;
      const bottom = heights[z1 * width + x0] * (1 - tx) + heights[z1 * width + x1] * tx;
      return top * (1 - tz) + bottom * tz;
    };
    for (let vertex = 0; vertex < data.buffers.waterwayVertices.count; vertex += 113) {
      const offset = vertex * 10;
      expect(vertices[offset + 1]).toBeGreaterThanOrEqual(0.079);
      expect(vertices[offset + 1]).toBeLessThanOrEqual(60.7);
      expect([0, 0.25, 1]).toContain(vertices[offset + 6]);
      expect(Math.hypot(vertices[offset + 7], vertices[offset + 8])).toBeGreaterThan(0.99);
      expect(vertices[offset + 9]).toBeGreaterThan(0);
      const x = vertices[offset], y = vertices[offset + 1], z = vertices[offset + 2];
      const px = Math.min(data.fields.navigation.width - 1, Math.max(0,
        Math.floor(((x % data.world.width) + data.world.width) % data.world.width / data.world.width * data.fields.navigation.width)));
      const pz = Math.min(data.fields.navigation.height - 1, Math.max(0,
        Math.floor(z / data.world.height * data.fields.navigation.height)));
      if (provinceIds[pz * data.fields.navigation.width + px] !== 0) {
        const lift = y - sampleTerrainHeight(x, z);
        // Stored float32 X/Z values can shift the resampled height slightly on
        // the steepest cells; the authored lift itself is 0.14-0.155.
        expect(lift).toBeGreaterThanOrEqual(0.12);
        expect(lift).toBeLessThanOrEqual(0.18);
        drapedLandVertices += 1;
      }
    }
    expect(drapedLandVertices).toBeGreaterThan(100);
    for (let vertex = 0; vertex < data.buffers.waterwayVertices.count; vertex += 1) {
      const offset = vertex * 10;
      if (vertices[offset + 5] > 0.01) continue;
      centerVertices += 1;
      const px = Math.min(data.fields.navigation.width - 1, Math.max(0,
        Math.floor(((vertices[offset] % data.world.width) + data.world.width) % data.world.width / data.world.width * data.fields.navigation.width)));
      const pz = Math.min(data.fields.navigation.height - 1, Math.max(0,
        Math.floor(vertices[offset + 2] / data.world.height * data.fields.navigation.height)));
      const pixel = pz * data.fields.navigation.width + px;
      // Mouth overlap samples deliberately stop clipping the base ocean once
      // both authored banks have opened. Every sample over land must still
      // carry the terrain-removal mask.
      if (provinceIds[pixel] !== 0) expect(maskBytes[pixel * 4 + 2]).toBe(255);
    }
    expect(centerVertices).toBeGreaterThan(10_000);
    for (let index = 0; index < indices.length; index += 127) expect(indices[index]).toBeLessThan(data.buffers.waterwayVertices.count);
    expect(data.infrastructureChunks.waterways).toHaveLength(512);
    expect(data.infrastructureChunks.waterways.reduce((sum, range) => sum + range.indexCount, 0)).toBe(indices.length);
    expect(data.counts.waterwayTriangles).toBeLessThan(700_000);
  });

  it('emits finite capped topography without terrain-class spikes', async () => {
    const data = await manifest();
    const [heightBytes, surfaceBytes, reportBytes] = await Promise.all([
      readFile('public/world/height.f32'), readFile('public/world/surface.rgba8'), readFile('public/world/world-generation-report.json', 'utf8'),
    ]);
    const heights = viewF32(heightBytes);
    const surface = new Uint8Array(surfaceBytes.buffer, surfaceBytes.byteOffset, surfaceBytes.byteLength);
    const report = JSON.parse(reportBytes);
    expect(heights.every(Number.isFinite)).toBe(true);
    let maximum = 0;
    for (let index = 0; index < heights.length; index += 1) if (surface[index * 4 + 3]) maximum = Math.max(maximum, heights[index]);
    expect(maximum).toBeLessThanOrEqual(60.5);
    for (let index = 0; index < heights.length; index += 997) {
      if (surface[index * 4 + 3]) expect(heights[index]).toBeGreaterThanOrEqual(1.199);
      else expect(heights[index]).toBe(0);
    }
    expect(report.topography.capViolations).toBe(0);
    expect(report.topography.maximumSlopeStep).toBeLessThanOrEqual(2.01);
    expect(report.topography.maximumHeight).toBeGreaterThan(53);
    expect(report.topography.terrainClasses.mountains.mean).toBeGreaterThan(23);
    expect(report.topography.terrainClasses.hills.mean).toBeGreaterThan(10);
    expect(report.topography.slopeRepairs).toBeGreaterThan(0);
    expect(report.topography.conditioning.maximumAdjustment).toBeLessThanOrEqual(12.001);
    expect(report.topography.conditioning.conditionedSegments).toBeGreaterThan(0);
    expect(report.topography.conditioning.conditionedSegments).toBeLessThan(7_805);
    const provinceById = new Map(data.provinces.map((province) => [province.id, province]));
    for (const adjustment of report.topography.conditioning.provinceAdjustments) {
      const terrain = provinceById.get(adjustment.provinceId)?.terrain;
      const meanBudget = terrain === 'Mountain' ? 6 : terrain === 'Hills' ? 4 : 2.5;
      expect(Math.abs(adjustment.mean)).toBeLessThanOrEqual(meanBudget + 0.001);
    }
    expect(data.terrain.maxHeight).toBeLessThanOrEqual(60.5);
  });

  it('drapes every emitted road vertex over final dry terrain', async () => {
    const data = await manifest();
    const [roadBytes, indexBytes, heightBytes, surfaceBytes] = await Promise.all([
      readFile('public/world/road-vertices.f32'), readFile('public/world/road-indices.u32'),
      readFile('public/world/height.f32'), readFile('public/world/surface.rgba8'),
    ]);
    const vertices = viewF32(roadBytes), indices = viewU32(indexBytes), heights = viewF32(heightBytes);
    const surface = new Uint8Array(surfaceBytes.buffer, surfaceBytes.byteOffset, surfaceBytes.byteLength);
    expect(vertices.length).toBe(data.buffers.roadVertices.count * 9);
    expect(indices.length).toBe(data.buffers.roadIndices.count);
    expect(vertices.every(Number.isFinite)).toBe(true);
    for (let index = 0; index < indices.length; index += 1009) expect(indices[index]).toBeLessThan(data.buffers.roadVertices.count);
    const width = data.fields.height.width, height = data.fields.height.height;
    const sampleHeight = (x: number, z: number) => {
      const fx = ((x % data.world.width) + data.world.width) % data.world.width / data.world.width * width - 0.5;
      const fz = Math.max(0, Math.min(height - 1, z / data.world.height * height - 0.5));
      const x0raw = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0raw, tz = fz - z0;
      const x0 = ((x0raw % width) + width) % width, x1 = (x0 + 1) % width, z1 = Math.min(height - 1, z0 + 1);
      const top = heights[z0 * width + x0] * (1 - tx) + heights[z0 * width + x1] * tx;
      const bottom = heights[z1 * width + x0] * (1 - tx) + heights[z1 * width + x1] * tx;
      return top * (1 - tz) + bottom * tz;
    };
    for (let vertex = 0; vertex < data.buffers.roadVertices.count; vertex += 503) {
      const offset = vertex * 9, x = vertices[offset], y = vertices[offset + 1], z = vertices[offset + 2];
      const px = Math.min(width - 1, Math.max(0, Math.floor(((x % data.world.width) + data.world.width) % data.world.width / data.world.width * width)));
      const pz = Math.min(height - 1, Math.max(0, Math.floor(z / data.world.height * height)));
      expect(surface[(pz * width + px) * 4 + 3]).toBeGreaterThan(0);
      const lift = y - sampleHeight(x, z);
      expect(lift).toBeGreaterThanOrEqual(0.079);
      expect(lift).toBeLessThanOrEqual(0.161);
    }
    expect(data.infrastructureChunks.roads).toHaveLength(512);
    expect(data.infrastructureChunks.roads.reduce((sum, range) => sum + range.indexCount, 0)).toBe(indices.length);
  }, 20_000);

  it('renders every omitted road as a floating dotted connector', async () => {
    const data = await manifest();
    const [vertexBytes, indexBytes] = await Promise.all([
      readFile('public/world/hidden-connection-vertices.f32'),
      readFile('public/world/hidden-connection-indices.u32'),
    ]);
    const vertices = viewF32(vertexBytes), indices = viewU32(indexBytes);
    expect(data.buffers.hiddenConnectionVertices.count).toBeGreaterThan(0);
    expect(vertices.length).toBe(data.buffers.hiddenConnectionVertices.count * 9);
    expect(indices.length).toBe(data.buffers.hiddenConnectionIndices.count);
    expect(vertices.every(Number.isFinite)).toBe(true);
    for (let vertex = 0; vertex < data.buffers.hiddenConnectionVertices.count; vertex += 97) {
      expect(vertices[vertex * 9 + 1]).toBeGreaterThanOrEqual(0.7);
      expect(vertices[vertex * 9 + 8]).toBe(1);
    }
    for (let index = 0; index < indices.length; index += 101) expect(indices[index]).toBeLessThan(data.buffers.hiddenConnectionVertices.count);
    expect(data.infrastructureChunks.hiddenConnections).toHaveLength(512);
    expect(data.infrastructureChunks.hiddenConnections.reduce((sum, range) => sum + range.indexCount, 0)).toBe(indices.length);
  });

  it('keeps every city building footprint clear of open water', async () => {
    const data = await manifest();
    const [buildingBytes, provinceIdBytes, reportBytes] = await Promise.all([
      readFile(`public/world/${data.buffers.buildings.url}`),
      readFile(`public/world/${data.fields.provinceIds.url}`),
      readFile('public/world/world-generation-report.json', 'utf8'),
    ]);
    const buildings = viewF32(buildingBytes);
    const provinceIds = new Uint16Array(
      provinceIdBytes.buffer, provinceIdBytes.byteOffset, provinceIdBytes.byteLength / 2,
    );
    const report = JSON.parse(reportBytes);
    const idWidth = data.fields.provinceIds.width;
    const idHeight = data.fields.provinceIds.height;
    const provinceAt = (x: number, z: number): number => {
      const wrapped = ((x % data.world.width) + data.world.width) % data.world.width;
      const px = Math.min(idWidth - 1, Math.floor(wrapped / data.world.width * idWidth));
      const pz = Math.min(idHeight - 1, Math.max(0, Math.floor(z / data.world.height * idHeight)));
      return provinceIds[pz * idWidth + px];
    };

    expect(buildings.length).toBe(data.buffers.buildings.count * 8);
    expect(report.props.rejectedCoastalFootprints).toBeGreaterThan(0);
    expect(report.props.coastalProvincesAffected).toBeGreaterThan(0);

    const texelWorld = data.world.width / idWidth;
    let checked = 0;
    let overWater = 0;
    for (let building = 0; building < data.buffers.buildings.count; building += 1) {
      const offset = building * 8;
      const x = buildings[offset];
      const z = buildings[offset + 1];
      // The actual base building box spans +/-0.5 of the instance scale; the
      // generator guards a wider region still, so this is a strict subset.
      const halfX = buildings[offset + 2] * 0.5;
      const halfZ = buildings[offset + 4] * 0.5;
      const cos = Math.cos(buildings[offset + 5]);
      const sin = Math.sin(buildings[offset + 5]);
      const stepsX = Math.max(1, Math.ceil(halfX / (texelWorld * 0.5)));
      const stepsZ = Math.max(1, Math.ceil(halfZ / (texelWorld * 0.5)));
      for (let ix = -stepsX; ix <= stepsX; ix += 1) {
        const localX = (ix / stepsX) * halfX;
        for (let iz = -stepsZ; iz <= stepsZ; iz += 1) {
          const localZ = (iz / stepsZ) * halfZ;
          const worldX = x + localX * cos - localZ * sin;
          const worldZ = z + localX * sin + localZ * cos;
          if (provinceAt(worldX, worldZ) === 0) overWater += 1;
        }
      }
      checked += 1;
    }
    expect(checked).toBe(data.buffers.buildings.count);
    expect(overWater).toBe(0);
  });

  it('packages complete mutable country ownership and label topology', async () => {
    const data = await manifest();
    const [ownerBytes, adjacencyBytes, labelBytes] = await Promise.all([
      readFile(`public/world/${data.politics.owners.url}`),
      readFile(`public/world/${data.politics.adjacency.url}`),
      readFile(`public/world/${data.politics.labelData.url}`),
    ]);
    const owners = viewU32(ownerBytes);
    const adjacency = viewU32(adjacencyBytes);
    const labels = viewF32(labelBytes);
    expect(data.politics.countries).toHaveLength(200);
    expect(new Set(data.politics.countries.map((country) => country.id)).size).toBe(200);
    expect(data.politics.countries.every((country) => /^#[0-9A-F]{6}$/i.test(country.color))).toBe(true);
    expect(new Set(data.politics.countries.map((country) => country.color)).size).toBe(200);
    expect(data.politics.countries.every((country) => country.colorFamily >= 0 && country.colorFamily < 6)).toBe(true);
    expect(owners.length).toBe(data.politics.owners.count);
    expect(adjacency.length).toBe(data.politics.adjacency.count * 2);
    expect(labels.length).toBe(data.politics.labelData.count * 3);
    expect(data.politics.owners.stride).toBe(1);
    expect(data.politics.adjacency.stride).toBe(2);
    expect(data.politics.labelData.stride).toBe(3);
    const countryIds = new Set(data.politics.countries.map((country) => country.id));
    const representedOwners = new Set<number>();
    for (const province of data.provinces) {
      const encodedId = province.id + 1;
      expect(countryIds.has(owners[encodedId])).toBe(true);
      expect(labels[encodedId * 3]).toBeGreaterThanOrEqual(0);
      expect(labels[encodedId * 3 + 1]).toBeGreaterThanOrEqual(0);
      expect(labels[encodedId * 3 + 2]).toBeGreaterThan(0);
      representedOwners.add(owners[encodedId]);
    }
    expect(representedOwners.size).toBe(200);
    for (let edge = 0; edge < adjacency.length; edge += 2) {
      expect(owners[adjacency[edge]]).toBeGreaterThan(0);
      expect(owners[adjacency[edge + 1]]).toBeGreaterThan(0);
      const countryA = data.politics.countries.find((country) => country.id === owners[adjacency[edge]]);
      const countryB = data.politics.countries.find((country) => country.id === owners[adjacency[edge + 1]]);
      if (countryA && countryB && countryA.id !== countryB.id) {
        expect(countryA.colorFamily).not.toBe(countryB.colorFamily);
      }
    }
  });

  it('distributes five tree silhouettes while keeping plains sparse and light green', async () => {
    const data = await manifest();
    const bytes = await readFile('public/world/trees.f32');
    const trees = viewF32(bytes);
    expect(trees.length).toBe(data.buffers.trees.count * 8);
    expect(data.buffers.trees.stride).toBe(8);
    const variants = new Set<number>();
    const palettes = new Set<number>();
    const countsByTerrain = new Map<string, number>();
    const provinceById = new Map(data.provinces.map((province) => [province.id, province]));
    let invalidVariant = false;
    let invalidPalette = false;
    let darkPlainTrees = 0;
    for (let tree = 0; tree < data.buffers.trees.count; tree += 1) {
      const offset = tree * 8;
      const variant = trees[offset + 3];
      const encodedProvince = trees[offset + 6];
      const palette = trees[offset + 7];
      if (!Number.isInteger(variant) || variant < 0 || variant > 4) invalidVariant = true;
      if (palette !== 0 && palette !== 1) invalidPalette = true;
      variants.add(variant);
      palettes.add(palette);
      const terrain = provinceById.get(encodedProvince - 1)?.terrain;
      if (!terrain) throw new Error(`Tree references unknown province ${encodedProvince - 1}`);
      countsByTerrain.set(terrain, (countsByTerrain.get(terrain) ?? 0) + 1);
      if (terrain === 'Plains' && palette !== 0) darkPlainTrees += 1;
    }
    expect(invalidVariant).toBe(false);
    expect(invalidPalette).toBe(false);
    expect(darkPlainTrees).toBe(0);
    expect([...variants].sort()).toEqual([0, 1, 2, 3, 4]);
    expect([...palettes].sort()).toEqual([0, 1]);
    const plainTrees = countsByTerrain.get('Plains') ?? 0;
    const forestTrees = countsByTerrain.get('Forest') ?? 0;
    const plainProvinceCount = data.provinces.filter((province) => province.terrain === 'Plains').length;
    const forestProvinceCount = data.provinces.filter((province) => province.terrain === 'Forest').length;
    expect(plainTrees).toBeGreaterThan(0);
    expect(plainTrees / plainProvinceCount).toBeLessThan((forestTrees / forestProvinceCount) * 0.25);
    expect(data.propChunks.trees).toHaveLength(data.propChunks.chunksX * data.propChunks.chunksY);
    expect(data.propChunks.trees.reduce((sum, range) => sum + range.instanceCount, 0)).toBe(data.buffers.trees.count);
    expect(data.propChunks.buildings.reduce((sum, range) => sum + range.instanceCount, 0)).toBe(data.buffers.buildings.count);
    for (const range of data.propChunks.trees) {
      expect(range.groups).toHaveLength(2);
      expect(range.groups.reduce((sum, group) => sum + group.instanceCount, 0)).toBe(range.instanceCount);
      for (let index = 0; index < range.groups[0].instanceCount; index += 1) {
        expect(trees[(range.groups[0].firstInstance + index) * 8 + 3]).not.toBe(2);
      }
      for (let index = 0; index < range.groups[1].instanceCount; index += 1) {
        expect(trees[(range.groups[1].firstInstance + index) * 8 + 3]).toBe(2);
      }
    }
  });

  it('reports every direct road and every omitted physical connection without corridor metadata', async () => {
    const data = await manifest();
    const [sourceBytes, reportBytes] = await Promise.all([
      readFile('material/movement/connection_segments.json', 'utf8'), readFile('public/world/world-generation-report.json', 'utf8'),
    ]);
    const source = JSON.parse(sourceBytes) as { segments: Array<{ segment_id: number; medium: string }> };
    const report = JSON.parse(reportBytes);
    const landIds = new Set(source.segments.filter((segment) => segment.medium === 'land').map((segment) => segment.segment_id));
    const unmapped = new Set<number>(report.roads.unmappedLandSegments);
    for (const road of report.roads.hiddenRoads) {
      expect(['water', 'crossing']).toContain(road.reason);
      expect(road.endpoints).toHaveLength(2);
      expect(road.affectedConnections.every((id: number) => landIds.has(id))).toBe(true);
    }
    expect(report.roads.hiddenRoads).toHaveLength(data.counts.hiddenRoads);
    expect(report.roads.emittedRoads + report.roads.hiddenRoadCount).toBe(report.roads.logicalRoads);
    expect(report.roads.logicalRoads).toBe(7_805);
    expect(unmapped.size).toBe(data.counts.unmappedLandSegments);
    expect(report.roads.gradeWarnings.length).toBe(data.counts.steepRoads);
    expect(data.counts.steepEmittedRoads).toBeGreaterThan(0);
  });

  it('removes all obsolete procedural-hydrology and structure files from generated output', async () => {
    for (const name of [
      'rivers.rgba8', 'river-vertices.f32', 'bridge-vertices.f32', 'tunnel-vertices.f32',
      'infrastructure-engineering.rgba8', 'engineering-vertices.f32', 'roads.rgba8',
      'corridor-metrics.f32', 'corridor-flags.u32', 'connection-corridor-offsets.u32',
      'connection-corridor-ids.u32', 'build.json', 'coast.r8',
      'far-albedo.rgba8', 'roads.rg8', 'waterways.rg8',
    ]) {
      await expect(access(`public/world/${name}`)).rejects.toThrow();
    }
  });
});
