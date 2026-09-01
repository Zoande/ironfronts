import { access, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInfrastructure } from './build-infrastructure.mjs';
import { auditLandConnections } from './infrastructure/segment-audit.mjs';
import { FIELD_HEIGHT, FIELD_WIDTH, ID_HEIGHT, ID_WIDTH, SEED, WORLD_HEIGHT, WORLD_WIDTH } from './world/config.mjs';
import { blurField, clamp, distanceToValue } from './world/raster.mjs';
import { writeTypedArtifact } from './world/artifact-writer.mjs';
import { buildBorders, buildConnections, chunkInstanceRecords, chunkLineRecords } from './world/chunk-packing.mjs';
import { buildInstances } from './world/instances.mjs';
import { generateTopography } from './world/topography.mjs';
import { buildBankField } from './world/water-fields.mjs';
import { buildWaterways } from './world/waterways.mjs';
import { buildTerrainAwareWaterways } from './world/terrain-aware-waterways.mjs';
import { fbm } from './world/noise.mjs';
import { buildVisualRiverField } from './world/visual-rivers.mjs';
import { carveRiverTerrain, buildTerrainTopology, promoteRiverChannelsToTerrain } from './world/river-overlay-terrain.mjs';
import { buildBakedTerrainAlbedo, buildNavigationField, buildTerrainNormals } from './world/terrain-precompute.mjs';
import { fillProvincePolygon, readMaterialJson } from './world/source-data.mjs';
import { buildPoliticalPalette } from './world/political-palette.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MATERIAL = path.join(ROOT, 'material');
const PUBLIC = path.join(ROOT, 'public');
const FINAL_OUTPUT = path.join(PUBLIC, 'world');
const OUTPUT = path.join(PUBLIC, `.world-staging-${process.pid}`);
const BACKUP_OUTPUT = path.join(PUBLIC, '.world-previous');
const TEXTURES = path.join(ROOT, 'public', 'textures');

function assertManagedOutput(target) {
  const relative = path.relative(PUBLIC, path.resolve(target));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to manage unexpected world output path: ${target}`);
  }
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function recoverInterruptedPromotion() {
  const [finalExists, backupExists] = await Promise.all([exists(FINAL_OUTPUT), exists(BACKUP_OUTPUT)]);
  if (!finalExists && backupExists) {
    await rename(BACKUP_OUTPUT, FINAL_OUTPUT);
    console.warn('Recovered the previous world package after an interrupted promotion.');
  } else if (finalExists && backupExists) {
    await rm(BACKUP_OUTPUT, { recursive: true, force: true });
  }
}

async function validateStagedWorld() {
  for (const name of ['world.json', 'province-ids.u16', 'height.f32', 'surface.rgba8']) {
    const info = await stat(path.join(OUTPUT, name));
    if (!info.isFile() || info.size === 0) throw new Error(`Generated world asset is empty: ${name}`);
  }
  const manifest = JSON.parse(await readFile(path.join(OUTPUT, 'world.json'), 'utf8'));
  if (manifest.counts?.provinces !== 3_303) throw new Error('Generated world manifest failed province-count validation');
}

async function promoteStagedWorld() {
  await validateStagedWorld();
  await rm(BACKUP_OUTPUT, { recursive: true, force: true });
  const hadPreviousWorld = await exists(FINAL_OUTPUT);
  if (hadPreviousWorld) await rename(FINAL_OUTPUT, BACKUP_OUTPUT);
  try {
    await rename(OUTPUT, FINAL_OUTPUT);
  } catch (error) {
    if (hadPreviousWorld && !await exists(FINAL_OUTPUT) && await exists(BACKUP_OUTPUT)) {
      await rename(BACKUP_OUTPUT, FINAL_OUTPUT);
    }
    throw error;
  }
  await rm(BACKUP_OUTPUT, { recursive: true, force: true });
}

const terrainCodes = new Map([
  [10, 0],
  [11, 1],
  [12, 2],
  [13, 3],
  [14, 4],
]);

const visualCodes = new Map([
  ['', 0],
  ['Desert', 1],
  ['Mediterranean', 2],
  ['Boreal', 3],
  ['Jungle', 4],
  ['Grassland', 5],
  ['Tundra', 6],
  ['Sand Dunes', 7],
  ['Arctic', 8],
]);

async function main() {
  for (const target of [FINAL_OUTPUT, OUTPUT, BACKUP_OUTPUT]) assertManagedOutput(target);
  await recoverInterruptedPromotion();
  await rm(OUTPUT, { recursive: true, force: true });
  await mkdir(OUTPUT, { recursive: true });

  const [geometry, metadata, markers, borderData, connectionData, networkData, mapMetadata,
    countryData, ownershipData, provinceAdjacencyData] = await Promise.all([
    readMaterialJson(MATERIAL, 'geometry/province_polygons_decoded.json'),
    readMaterialJson(MATERIAL, 'metadata/provinces.json'),
    readMaterialJson(MATERIAL, 'geometry/terrain_marker_positions.json'),
    readMaterialJson(MATERIAL, 'topology/logical_border_segments.json'),
    readMaterialJson(MATERIAL, 'movement/connection_segments.json'),
    readMaterialJson(MATERIAL, 'movement/network_nodes.json'),
    readMaterialJson(MATERIAL, 'metadata/map_metadata.json'),
    readMaterialJson(MATERIAL, 'metadata/countries.json'),
    readMaterialJson(MATERIAL, 'metadata/initial_ownership.json'),
    readMaterialJson(MATERIAL, 'topology/province_adjacency.json'),
  ]);

  if (geometry.provinces.length !== 3_303 || metadata.provinces.length !== 3_303) {
    throw new Error('Expected 3,303 provinces in geometry and metadata');
  }

  console.log(`Rasterizing ${geometry.provinces.length} provinces at ${ID_WIDTH}x${ID_HEIGHT}…`);
  const provinceIds = new Uint16Array(ID_WIDTH * ID_HEIGHT);
  const geometryById = new Map();
  for (const province of geometry.provinces) {
    geometryById.set(province.province_id, province);
    for (const component of province.components) fillProvincePolygon(provinceIds, component, province.province_id + 1);
  }
  const metadataById = new Map(metadata.provinces.map((province) => [province.province_id, province]));
  const maximumProvinceId = Math.max(...metadata.provinces.map((province) => province.province_id));
  const areaCounts = new Uint32Array(maximumProvinceId + 2);
  for (const encodedId of provinceIds) areaCounts[encodedId] += 1;
  const provinceOwners = new Uint32Array(maximumProvinceId + 2);
  for (const ownership of ownershipData.ownership) {
    provinceOwners[ownership.province_id + 1] = ownership.initial_owner_id;
  }
  const provinceLabelData = new Float32Array((maximumProvinceId + 2) * 3);
  for (const province of metadata.provinces) {
    const encodedId = province.province_id + 1;
    provinceLabelData[encodedId * 3] = province.center_x;
    provinceLabelData[encodedId * 3 + 1] = province.center_y;
    provinceLabelData[encodedId * 3 + 2] = areaCounts[encodedId];
  }
  const provinceAdjacency = new Uint32Array(provinceAdjacencyData.adjacencies.length * 2);
  for (let index = 0; index < provinceAdjacencyData.adjacencies.length; index += 1) {
    const adjacency = provinceAdjacencyData.adjacencies[index];
    provinceAdjacency[index * 2] = adjacency.province_a_id + 1;
    provinceAdjacency[index * 2 + 1] = adjacency.province_b_id + 1;
  }
  const politicalPalette = buildPoliticalPalette(countryData.countries, provinceOwners, provinceAdjacency, SEED);
  const countries = countryData.countries.map((country) => ({
    id: country.country_id,
    name: country.nation_name,
    ...politicalPalette.get(country.country_id),
    capitalProvinceId: country.capital_province_id,
  }));
  if (metadata.provinces.some((province) => provinceOwners[province.province_id + 1] === 0)) {
    throw new Error('Every province must have an initial country owner');
  }

  console.log(`Building ${FIELD_WIDTH}x${FIELD_HEIGHT} terrain fields…`);
  const surface = new Uint8Array(FIELD_WIDTH * FIELD_HEIGHT * 4);
  const landField = new Float32Array(FIELD_WIDTH * FIELD_HEIGHT);
  const reliefField = new Float32Array(FIELD_WIDTH * FIELD_HEIGHT);
  const terrainField = new Uint8Array(FIELD_WIDTH * FIELD_HEIGHT);
  const biomeField = new Uint8Array(FIELD_WIDTH * FIELD_HEIGHT);
  const provinceField = new Uint16Array(FIELD_WIDTH * FIELD_HEIGHT);

  for (let y = 0; y < FIELD_HEIGHT; y += 1) {
    const idY = Math.min(ID_HEIGHT - 1, Math.floor((y + 0.5) / FIELD_HEIGHT * ID_HEIGHT));
    for (let x = 0; x < FIELD_WIDTH; x += 1) {
      const idX = Math.min(ID_WIDTH - 1, Math.floor((x + 0.5) / FIELD_WIDTH * ID_WIDTH));
      const encodedId = provinceIds[idY * ID_WIDTH + idX];
      const index = y * FIELD_WIDTH + x;
      if (encodedId === 0) {
        terrainField[index] = 255;
        continue;
      }
      const province = metadataById.get(encodedId - 1);
      provinceField[index] = encodedId;
      const terrain = terrainCodes.get(province.terrain_type_id) ?? 0;
      const biome = visualCodes.get(province.visual_terrain_tag ?? '') ?? 0;
      terrainField[index] = terrain;
      biomeField[index] = biome;
      landField[index] = 1;
      reliefField[index] = [12, 46, 126, 30, 10][terrain];
    }
  }
  const provisionalCoastBlend = blurField(landField.slice(), FIELD_WIDTH, FIELD_HEIGHT, 5, 3);
  const provisionalLandDistance = distanceToValue(landField, FIELD_WIDTH, FIELD_HEIGHT, 0);
  let topography = generateTopography({
    landField, terrainField, provinceField, coastBlend: provisionalCoastBlend, landDistance: provisionalLandDistance,
    markers, borderData, connectionData, networkData, provinces: metadata.provinces,
  });
  let heights = topography.heights;
  let topographyReport = topography.report;

  console.log('Packing movement graph, forests, and cities…');
  const suppressedLandConnections = auditLandConnections(connectionData, {
    landField, fieldWidth: FIELD_WIDTH, fieldHeight: FIELD_HEIGHT,
    worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT,
  });
  console.log(`Movement graph: ${suppressedLandConnections.size} land connection segments cross water — flagged untraversable (node ids unchanged).`);
  const connections = buildConnections(connectionData, suppressedLandConnections);

  // The first pass supplies the exclusion mask used to distinguish authored
  // movement rivers from visual-only topology channels.
  console.log('Preparing river corridors...');
  const preliminaryWaterways = buildWaterways({
    networkData, connectionData, provinceIds, idWidth: ID_WIDTH, idHeight: ID_HEIGHT, heights,
    heightWidth: FIELD_WIDTH, heightHeight: FIELD_HEIGHT, worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT,
  });
  console.log('Expanding narrow visual-only river channels...');
  const visualRivers = buildVisualRiverField({
    provinceIds, movementMask: preliminaryWaterways.mask, networkData, connectionData, width: ID_WIDTH, height: ID_HEIGHT,
    worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT,
  });
  console.log('Restoring river channels as intact overlay terrain...');
  const riverTerrain = promoteRiverChannelsToTerrain({
    landField, terrainField, biomeField, provinceField, reliefField,
    width: FIELD_WIDTH, height: FIELD_HEIGHT,
    movementMask: preliminaryWaterways.mask, visualMask: visualRivers.mask,
    maskWidth: ID_WIDTH, maskHeight: ID_HEIGHT,
  });
  const terrainLandField = riverTerrain.terrainLandField;
  const terrainCoastBlend = blurField(terrainLandField.slice(), FIELD_WIDTH, FIELD_HEIGHT, 5, 3);
  const terrainLandDistance = distanceToValue(terrainLandField, FIELD_WIDTH, FIELD_HEIGHT, 0);
  topography = generateTopography({
    landField: terrainLandField, terrainField, provinceField,
    coastBlend: terrainCoastBlend, landDistance: terrainLandDistance,
    markers, borderData, connectionData, networkData, provinces: metadata.provinces,
  });
  heights = topography.heights;
  topographyReport = topography.report;
  topographyReport.riverOverlayRestoration = {
    method: 'province-zero river channels promoted before final topography generation',
    restoredCells: riverTerrain.restoredCells,
  };
  console.log('Carving shallow river beds and banks...');
  topographyReport.riverCarving = carveRiverTerrain({
    heights, landField: terrainLandField, width: FIELD_WIDTH, height: FIELD_HEIGHT,
    worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT,
    movementMask: preliminaryWaterways.mask, visualMask: visualRivers.mask,
    maskWidth: ID_WIDTH, maskHeight: ID_HEIGHT,
  });
  const terrainTopology = buildTerrainTopology(provinceIds, preliminaryWaterways.mask, visualRivers.mask);
  const riverMask = new Uint8Array(provinceIds.length);
  for (let index = 0; index < riverMask.length; index += 1) {
    riverMask[index] = preliminaryWaterways.mask[index] > 127 || visualRivers.mask[index] > 127 ? 1 : 0;
  }
  const bankField = buildBankField(
    provinceIds, ID_WIDTH, ID_HEIGHT, WORLD_WIDTH, WORLD_HEIGHT, terrainTopology, riverMask,
  );
  const oceanDistance = distanceToValue(terrainLandField, FIELD_WIDTH, FIELD_HEIGHT, 1);
  for (let y = 0; y < FIELD_HEIGHT; y += 1) {
    const v = y / Math.max(1, FIELD_HEIGHT - 1);
    for (let x = 0; x < FIELD_WIDTH; x += 1) {
      const index = y * FIELD_WIDTH + x, offset = index * 4;
      if (!terrainLandField[index]) {
        surface[offset + 2] = Math.round(clamp(oceanDistance[index] / 42, 0, 1) * 255);
        continue;
      }
      surface[offset] = terrainField[index];
      surface[offset + 1] = biomeField[index];
      surface[offset + 2] = Math.round(fbm(x / FIELD_WIDTH, v) * 255);
      surface[offset + 3] = 255;
    }
  }
  console.log('Draping movement and visual river surfaces over terrain...');
  const waterways = buildTerrainAwareWaterways({
    visualMask: visualRivers.mask,
    networkData, connectionData, provinceIds, idWidth: ID_WIDTH, idHeight: ID_HEIGHT, heights,
    heightWidth: FIELD_WIDTH, heightHeight: FIELD_HEIGHT, worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT,
  });
  visualRivers.report.surface = waterways.report.visualSurface.surface;
  visualRivers.report.surfaceHeightRange = waterways.report.visualSurface.heightRange;
  visualRivers.report.maximumSurfaceGrade = waterways.report.visualSurface.maximumLocalGrade;

  const waterwayField = new Uint8Array(ID_WIDTH * ID_HEIGHT * 2);
  for (let index = 0; index < provinceIds.length; index += 1) {
    waterwayField[index * 2] = waterways.mask[index];
    waterwayField[index * 2 + 1] = visualRivers.mask[index];
  }

  console.log('Compiling direct province-center roads and city placement...');
  const infrastructure = buildInfrastructure({
    borderData, connectionData, networkData, provinces: metadata.provinces, heights, landField,
    fieldWidth: FIELD_WIDTH, fieldHeight: FIELD_HEIGHT, roadFieldWidth: ID_WIDTH, roadFieldHeight: ID_HEIGHT,
    worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT,
  });
  const placementClearance = infrastructure.roadClearance.slice();
  for (let index = 0; index < placementClearance.length; index += 1) {
    placementClearance[index] = Math.max(placementClearance[index], waterways.clearance[index], visualRivers.clearance[index]);
  }
  const generatedInstances = buildInstances(metadata.provinces, geometryById, provinceIds, areaCounts, placementClearance, infrastructure.cityPlans);
  console.log(`Rejected ${generatedInstances.audit.rejectedCoastalFootprints} building footprints overlapping open water across ${generatedInstances.audit.coastalProvincesAffected} coastal provinces.`);
  const treeChunks = chunkInstanceRecords(generatedInstances.trees, (data, offset) => data[offset + 3] === 2 ? 1 : 0, 2);
  const buildingChunks = chunkInstanceRecords(generatedInstances.buildings, (data, offset) => Math.round(data[offset + 7]), 5);
  const lampChunks = chunkInstanceRecords(infrastructure.lamps);
  const barrierChunks = chunkInstanceRecords(infrastructure.barriers);
  const signChunks = chunkInstanceRecords(infrastructure.signs);
  const trees = treeChunks.data;
  const buildings = buildingChunks.data;
  const borderChunks = chunkLineRecords(buildBorders(borderData, heights));
  const borders = borderChunks.data;
  console.log('Precomputing terrain normals, navigation channels, material albedo, and prop occlusion...');
  const terrainNormals = buildTerrainNormals({
    heights, width: FIELD_WIDTH, height: FIELD_HEIGHT, worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT,
  });
  const navigationField = buildNavigationField(infrastructure.roadField, waterwayField);
  const terrainAlbedo = await buildBakedTerrainAlbedo({
    textureDirectory: TEXTURES, heights, surface,
    coastField: bankField.field, coastWidth: ID_WIDTH, coastHeight: ID_HEIGHT,
    width: FIELD_WIDTH, height: FIELD_HEIGHT, worldWidth: WORLD_WIDTH, worldHeight: WORLD_HEIGHT,
    trees, buildings,
  });

  const provinceRecords = metadata.provinces.map((province) => ({
    id: province.province_id,
    name: province.name,
    terrain: province.terrain_type,
  }));
  const provinceDetails = {
    version: 1,
    provinces: metadata.provinces.map((province) => ({
      id: province.province_id,
      center: [province.center_x, province.center_y],
      terrainId: province.terrain_type_id,
      visualBiome: province.visual_terrain_tag ?? '',
      population: province.population ?? 0,
      coastal: province.coastal_flag,
    })),
  };

  let maxHeight = 0;
  for (const height of heights) maxHeight = Math.max(maxHeight, height);

  const worldGenerationReport = {
    version: 'world-generation-v12',
    topography: topographyReport,
    banks: bankField.report,
    waterways: waterways.report,
    visualRivers: visualRivers.report,
    roads: infrastructure.roadReport,
    movementGraph: {
      landConnections: connectionData.segments.filter((segment) => segment.medium === 'land').length,
      waterCrossingSuppressed: suppressedLandConnections.size,
    },
    props: {
      rejectedCoastalFootprints: generatedInstances.audit.rejectedCoastalFootprints,
      coastalProvincesAffected: generatedInstances.audit.coastalProvincesAffected,
    },
  };

  const manifest = {
    version: 12,
    source: { mapId: mapMetadata.map_id, mapVersion: mapMetadata.map_version },
    generatedSeed: SEED,
    world: { width: WORLD_WIDTH, height: WORLD_HEIGHT, overlapX: 250, wrapX: true },
    fields: {
      height: { url: 'height.f32', width: FIELD_WIDTH, height: FIELD_HEIGHT, format: 'r32float' },
      surface: { url: 'surface.rgba8', width: FIELD_WIDTH, height: FIELD_HEIGHT, format: 'rgba8uint' },
      terrainNormal: { url: 'terrain-normal.rg8', width: FIELD_WIDTH, height: FIELD_HEIGHT, format: 'rg8snorm' },
      terrainAlbedo: {
        url: 'terrain-albedo.rgba8', width: FIELD_WIDTH, height: FIELD_HEIGHT,
        format: 'rgba8unorm-srgb', mipLevelCount: terrainAlbedo.mipLevelCount,
      },
      navigation: { url: 'navigation.rgba8', width: ID_WIDTH, height: ID_HEIGHT, format: 'rgba8unorm' },
      coast: { url: 'coast.rg8', width: ID_WIDTH, height: ID_HEIGHT, format: 'rg8unorm' },
      provinceIds: { url: 'province-ids.u16', width: ID_WIDTH, height: ID_HEIGHT, format: 'r16uint' },
    },
    buffers: {
      borders: { url: 'borders.f32', count: borders.length / 8, stride: 8 },
      connections: { url: 'connections.f32', count: connections.length / 8, stride: 8, lazy: true },
      roadVertices: { url: 'road-vertices.f32', count: infrastructure.roadVertices.length / 9, stride: 9 },
      roadIndices: { url: 'road-indices.u32', count: infrastructure.roadIndices.length, stride: 1 },
      hiddenConnectionVertices: { url: 'hidden-connection-vertices.f32', count: infrastructure.hiddenConnectionVertices.length / 9, stride: 9 },
      hiddenConnectionIndices: { url: 'hidden-connection-indices.u32', count: infrastructure.hiddenConnectionIndices.length, stride: 1 },
      waterwayVertices: { url: 'waterway-vertices.f32', count: waterways.vertices.length / 10, stride: 10 },
      waterwayIndices: { url: 'waterway-indices.u32', count: waterways.indices.length, stride: 1 },
      waterwayNetworkLines: { url: 'waterway-network-lines.f32', count: waterways.networkLines.length / 8, stride: 8, lazy: true },
      trees: { url: 'trees.f32', count: trees.length / 8, stride: 8 },
      buildings: { url: 'buildings.f32', count: buildings.length / 8, stride: 8 },
      lamps: { url: 'lamps.f32', count: lampChunks.data.length / 8, stride: 8 },
      barriers: { url: 'barriers.f32', count: barrierChunks.data.length / 8, stride: 8 },
      signs: { url: 'signs.f32', count: signChunks.data.length / 8, stride: 8 },
    },
    terrain: { chunksX: 32, chunksY: 16, gridResolution: 49, maxHeight },
    infrastructureChunks: { ...infrastructure.chunkRanges, waterways: waterways.chunkRanges },
    borderChunks: {
      chunksX: borderChunks.chunksX,
      chunksY: borderChunks.chunksY,
      ranges: borderChunks.ranges,
    },
    propChunks: {
      chunksX: 32, chunksY: 16,
      trees: treeChunks.ranges, buildings: buildingChunks.ranges,
      lamps: lampChunks.ranges, barriers: barrierChunks.ranges, signs: signChunks.ranges,
    },
    reports: { generation: { url: 'world-generation-report.json', version: worldGenerationReport.version } },
    sidecars: { provinceDetails: { url: 'province-details.json', version: provinceDetails.version } },
    politics: {
      owners: { url: 'province-owners.u32', count: provinceOwners.length, stride: 1 },
      adjacency: { url: 'province-adjacency.u32', count: provinceAdjacency.length / 2, stride: 2 },
      labelData: { url: 'province-label-data.f32', count: provinceLabelData.length / 3, stride: 3 },
      countries,
    },
    showcases: { ...infrastructure.showcases, ...waterways.showcases },
    counts: {
      provinces: provinceRecords.length,
      countries: countries.length,
      borders: borders.length / 8,
      trees: trees.length / 8,
      buildings: buildings.length / 8,
      connections: connections.length / 8,
      waterCrossingSuppressedConnections: suppressedLandConnections.size,
      ...waterways.stats,
      ...visualRivers.stats,
      ...infrastructure.stats,
      lamps: lampChunks.data.length / 8,
      barriers: barrierChunks.data.length / 8,
      signs: signChunks.data.length / 8,
    },
    provinces: provinceRecords,
  };

  await Promise.all([
    writeTypedArtifact(OUTPUT, 'province-ids.u16', provinceIds),
    writeTypedArtifact(OUTPUT, 'province-owners.u32', provinceOwners),
    writeTypedArtifact(OUTPUT, 'province-adjacency.u32', provinceAdjacency),
    writeTypedArtifact(OUTPUT, 'province-label-data.f32', provinceLabelData),
    writeTypedArtifact(OUTPUT, 'height.f32', heights),
    writeTypedArtifact(OUTPUT, 'surface.rgba8', surface),
    writeTypedArtifact(OUTPUT, 'terrain-normal.rg8', terrainNormals),
    writeTypedArtifact(OUTPUT, 'terrain-albedo.rgba8', terrainAlbedo.data),
    writeTypedArtifact(OUTPUT, 'navigation.rgba8', navigationField),
    writeTypedArtifact(OUTPUT, 'coast.rg8', bankField.field),
    writeTypedArtifact(OUTPUT, 'borders.f32', borders),
    writeTypedArtifact(OUTPUT, 'connections.f32', connections),
    writeTypedArtifact(OUTPUT, 'road-vertices.f32', infrastructure.roadVertices),
    writeTypedArtifact(OUTPUT, 'road-indices.u32', infrastructure.roadIndices),
    writeTypedArtifact(OUTPUT, 'hidden-connection-vertices.f32', infrastructure.hiddenConnectionVertices),
    writeTypedArtifact(OUTPUT, 'hidden-connection-indices.u32', infrastructure.hiddenConnectionIndices),
    writeTypedArtifact(OUTPUT, 'waterway-vertices.f32', waterways.vertices),
    writeTypedArtifact(OUTPUT, 'waterway-indices.u32', waterways.indices),
    writeTypedArtifact(OUTPUT, 'waterway-network-lines.f32', waterways.networkLines),
    writeTypedArtifact(OUTPUT, 'trees.f32', trees),
    writeTypedArtifact(OUTPUT, 'buildings.f32', buildings),
    writeTypedArtifact(OUTPUT, 'lamps.f32', lampChunks.data),
    writeTypedArtifact(OUTPUT, 'barriers.f32', barrierChunks.data),
    writeTypedArtifact(OUTPUT, 'signs.f32', signChunks.data),
    writeFile(path.join(OUTPUT, 'world-generation-report.json'), `${JSON.stringify(worldGenerationReport, null, 2)}\n`),
    writeFile(path.join(OUTPUT, 'province-details.json'), `${JSON.stringify(provinceDetails)}\n`),
    writeFile(path.join(OUTPUT, 'world.json'), `${JSON.stringify(manifest)}\n`),
  ]);
  await promoteStagedWorld();
  console.log(`World assets ready: ${provinceRecords.length} provinces, ${waterways.stats.riverSystems} river systems, ${waterways.stats.canalSystems} canals, ${infrastructure.stats.logicalRoads} logical roads (${infrastructure.stats.emittedRoads} visible, ${infrastructure.stats.hiddenRoads} hidden), ${trees.length / 8} trees, ${buildings.length / 8} buildings.`);
}

main().catch(async (error) => {
  await rm(OUTPUT, { recursive: true, force: true }).catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
});
