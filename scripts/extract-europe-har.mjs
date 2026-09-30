/** Extract only the static Europe map and sanitized opening ownership from a local HAR. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE = path.join(ROOT, 'www.callofwar.com.har');
const OUT = path.join(ROOT, 'material', 'europe');
const entries = JSON.parse(await readFile(SOURCE, 'utf8')).log.entries;
const entry = (pattern) => entries.find((item) => pattern.test(new URL(item.request.url).pathname));
const staticMap = JSON.parse(entry(/\/23114_3@high\.json$/).response.content.text);
const captured = JSON.parse(entries.find((item) => {
    const text = item.response?.content?.text;
    return text?.startsWith('{"result":{"@c":"ultshared.UltGameState"');
  })?.response?.content?.text ?? 'null');
if (staticMap.mapID !== '23114_3' || !captured?.result?.states?.['3']) {
  throw new Error('The HAR does not contain the expected Europe map and opening game state.');
}
const states = captured.result.states;
const dynamic = new Map(Object.values(states['3'].map.locations).map((location) => [location.id, location]));
const players = states['1'].players;
const provinces = staticMap.locations.filter((location) => location['@c'] === 'p').sort((a, b) => a.id - b.id);
const seaPoints = staticMap.locations.filter((location) => location['@c'] === 'sp');
const names = new Map(staticMap.locations.map((location) => [location.id, dynamic.get(location.id)?.n ?? `Sea ${location.id}`]));
const owner = (location) => dynamic.get(location.id)?.o ?? location.ci?.[0] ?? 0;
const decodeBoundary = (value) => {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length % 4) throw new Error('Malformed province boundary.');
  return Array.from({ length: bytes.length / 4 }, (_, i) => [bytes.readUInt16BE(i * 4), bytes.readUInt16BE(i * 4 + 2)]);
};
const terrainNames = { 10: 'Plains', 11: 'Hills', 12: 'Mountain', 13: 'Forest', 14: 'Urban' };
const rgbaHex = (value) => {
  const match = /^rgba\((\d+),(\d+),(\d+),\d+\)$/.exec(value ?? '');
  return match ? `#${match.slice(1, 4).map((part) => Number(part).toString(16).padStart(2, '0')).join('').toUpperCase()}` : '#808080';
};
const countries = [...new Set(provinces.map(owner))].sort((a, b) => a - b).map((id) => {
  const profile = players[id] ?? {};
  return {
    country_id: id, nation_name: profile.nationName || `Nation ${id}`,
    nation_adjective: profile.nationAdjective ?? '', nation_title: profile.title ?? '',
    capital_province_id: profile.capitalID ?? -1, nationality_id: profile.nationality ?? id,
    faction_id: profile.faction ?? 0, primary_color_rgba: profile.primaryColor ?? '',
    primary_color_hex: rgbaHex(profile.primaryColor), secondary_color_rgba: profile.secondaryColor ?? '',
    secondary_color_hex: rgbaHex(profile.secondaryColor),
  };
});
const countryById = new Map(countries.map((country) => [country.country_id, country]));
const geometry = provinces.map((province) => ({
  province_id: province.id, name: names.get(province.id), center: province.c,
  components: [decodeBoundary(province.b), ...(province.xb ?? []).map((component) => component.map(({ x, y }) => [x, y]))],
}));
const provinceMetadata = provinces.map((province) => ({
  province_id: province.id, name: names.get(province.id), center_x: province.c.x, center_y: province.c.y,
  component_count: 1 + (province.xb?.length ?? 0), core_country_ids: province.ci ?? [],
  initial_owner_id: owner(province), initial_owner_name: countryById.get(owner(province))?.nation_name ?? '',
  initial_owner_color: countryById.get(owner(province))?.primary_color_hex ?? '#808080',
  terrain_type_id: province.tt, terrain_type: terrainNames[province.tt] ?? 'Plains',
  visual_terrain_tag: province.vtt ?? '', population: province.p ?? 0, victory_points: province.vp ?? 0,
  coastal_flag: province.co ?? false, region_ids: province.rg ?? [], region_names: [],
  resource_production: province.cp ?? {}, raw_resource_code_r: province.r ?? null,
  raw_resource_field_bp: province.bp ?? null, has_explicit_terrain_markers: !!province.tmp?.length,
  explicit_terrain_marker_count: province.tmp?.length ?? 0,
}));
const ownership = provinces.map((province) => ({
  province_id: province.id, province_name: names.get(province.id), initial_owner_id: owner(province),
  initial_owner_name: countryById.get(owner(province))?.nation_name ?? '',
  initial_owner_color: countryById.get(owner(province))?.primary_color_hex ?? '#808080',
  core_country_id: province.ci?.[0] ?? 0, captured_day0_owner_id: owner(province),
  core_matches_captured_owner: owner(province) === province.ci?.[0],
}));
const markers = provinces.flatMap((province) => (province.tmp ?? []).map((point, marker_index) => ({
  province_id: province.id, name: names.get(province.id), marker_index,
  x: point.x, y: point.y, terrain_type_id: province.tt, terrain_type: terrainNames[province.tt] ?? 'Plains',
})));
const resourceTypes = Object.fromEntries(Object.entries(states['11'].resourceEntries)
  .map(([id, value]) => [id, value.name]));
const resourceIds = [1, 3, 4, 5, 20];
const mesh = staticMap.triangulations;
const coordinatePairs = (flat, divisor) => Array.from({ length: flat.length / 2 }, (_, i) => [flat[i * 2] / divisor, flat[i * 2 + 1] / divisor]);
const meshComponents = mesh.borderTriangulations.flatMap((parts, index) => parts.map((part, component_index) => ({
  province_id: mesh.provinceIds[index], province_name: names.get(mesh.provinceIds[index]), component_index,
  triangle_indices: part.t, edge_vertices_raw: part.e, edge_vertices: coordinatePairs(part.e, mesh.precision),
  inner_border_vertices_raw: part.ib, inner_border_vertices: coordinatePairs(part.ib, mesh.precision),
  edge_normals_encoded_u8: part.en, edge_normals_encoded_pairs: coordinatePairs(part.en, 1),
  edge_indices: part.ei ?? null,
})));
const meshIndex = mesh.provinceIds.map((id, index) => {
  const [min_x_raw, min_y_raw, max_x_raw, max_y_raw] = mesh.provinceBounds.slice(index * 4, index * 4 + 4);
  return { province_id: id, province_name: names.get(id), component_count: mesh.borderTriangulations[index].length,
    min_x_raw, min_y_raw, max_x_raw, max_y_raw,
    min_x: min_x_raw / mesh.precision, min_y: min_y_raw / mesh.precision,
    max_x: max_x_raw / mesh.precision, max_y: max_y_raw / mesh.precision };
});

// Each `bn` entry lists neighbors touching the corresponding boundary vertex.
// Adjacent vertices with a common neighbor describe one exact shared edge.
const borders = [];
const adjacency = new Map();
const provinceById = new Map(provinces.map((province) => [province.id, province]));
for (const province of provinces) {
  const points = decodeBoundary(province.b);
  const bits = Buffer.from(province.bt ?? '', 'base64');
  const edgeKind = (i) => {
    const neighbors = (province.bn?.[i] ?? []).filter((id) => (province.bn?.[(i + 1) % points.length] ?? []).includes(id));
    const neighbor = neighbors.find((id) => provinceById.has(id));
    const coastline = !neighbors.length || ((bits[i] ?? 0) & 1) !== 0 && neighbor === undefined;
    if (coastline) return [null, 'coastline'];
    return [neighbor ?? null, owner(province) === owner(provinceById.get(neighbor))
      ? 'same_core_shared_border' : 'different_core_shared_border'];
  };
  const runs = [];
  for (let i = 0; i < points.length; i++) {
    const [neighbor, boundary_kind] = edgeKind(i);
    const a = points[i], b = points[(i + 1) % points.length];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const previous = runs.at(-1);
    if (previous && previous.neighbor_province_id === neighbor && previous.boundary_kind === boundary_kind) {
      previous.edge_count++;
      previous.length += length;
      previous.coordinates.push(b);
    } else {
      runs.push({ province_id: province.id, province_name: names.get(province.id),
        neighbor_province_id: neighbor, neighbor_province_name: neighbor === null ? '' : names.get(neighbor),
        boundary_kind, edge_count: 1, length, coordinates: [a, b] });
    }
    if (neighbor !== null) {
      const id = [province.id, neighbor].sort((x, y) => x - y).join(':');
      const pair = adjacency.get(id) ?? {
        province_a_id: Math.min(province.id, neighbor), province_a_name: names.get(Math.min(province.id, neighbor)),
        province_b_id: Math.max(province.id, neighbor), province_b_name: names.get(Math.max(province.id, neighbor)),
        same_initial_core_country: owner(province) === owner(provinceById.get(neighbor)),
        initial_country_a: owner(provinceById.get(Math.min(province.id, neighbor))),
        initial_country_b: owner(provinceById.get(Math.max(province.id, neighbor))),
        directed_edge_piece_count: 0, summed_directed_edge_length: 0,
      };
      pair.directed_edge_piece_count++;
      pair.summed_directed_edge_length += length;
      adjacency.set(id, pair);
    }
  }
  if (runs.length > 1 && runs[0].neighbor_province_id === runs.at(-1).neighbor_province_id
    && runs[0].boundary_kind === runs.at(-1).boundary_kind) {
    const last = runs.pop();
    runs[0].coordinates = [...last.coordinates.slice(0, -1), ...runs[0].coordinates];
    runs[0].edge_count += last.edge_count;
    runs[0].length += last.length;
  }
  for (const run of runs) borders.push({ segment_id: borders.length, ...run });
}

const rawConnections = Buffer.from(staticMap.connections_v2, 'base64');
const nodeByPoint = new Map();
const nodes = [];
const nodeId = (x, y) => {
  const key = `${x},${y}`;
  if (!nodeByPoint.has(key)) {
    nodeByPoint.set(key, nodes.length);
    nodes.push({ node_id: nodes.length, x, y, kind: 'connection', location_id: -1, location_name: '', degree: 0 });
  }
  return nodeByPoint.get(key);
};
const connections = [];
for (let offset = 0; offset < rawConnections.length; offset += 24) {
  const location_id = rawConnections.readInt32BE(offset);
  const type = rawConnections.readInt32BE(offset + 4);
  const [x1, y1, x2, y2] = [8, 12, 16, 20].map((at) => rawConnections.readInt32BE(offset + at) / 100);
  const node_a = nodeId(x1, y1), node_b = nodeId(x2, y2);
  nodes[node_a].degree++; nodes[node_b].degree++;
  connections.push({ segment_id: connections.length, location_id, type,
    medium: location_id < 0 ? 'sea' : 'land', x1, y1, x2, y2,
    length: Math.hypot(x2 - x1, y2 - y1), node_a, node_b });
}
for (const location of staticMap.locations) {
  const id = nodeByPoint.get(`${location.c.x},${location.c.y}`);
  if (id === undefined) continue;
  nodes[id].kind = location['@c'] === 'sp' ? 'sea_point' : 'province_center';
  nodes[id].location_id = location.id;
  nodes[id].location_name = names.get(location.id);
}

async function output(relative, value) {
  const target = path.join(OUT, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
}
await Promise.all([
  output('source/23114_3@high.original.json', staticMap),
  output('source/connections_v2.bin', rawConnections),
  output('source/triangulations.original.json', staticMap.triangulations),
  output('mesh/triangulations_decoded.json', { version: mesh.version, precision: mesh.precision,
    component_count: meshComponents.length, components: meshComponents }),
  output('mesh/province_mesh_index.json', { precision: mesh.precision, province_sizes_raw: mesh.provinceSizes,
    province_sizes_decoded: Object.fromEntries(Object.entries(mesh.provinceSizes).map(([key, value]) => [key, value / mesh.precision])),
    map_bounds_raw: mesh.mapBounds,
    map_bounds_decoded: Object.fromEntries(Object.entries(mesh.mapBounds).map(([key, value]) => [key, value / mesh.precision])),
    provinces: meshIndex }),
  output('geometry/province_polygons_decoded.json', { map_id: staticMap.mapID, width: staticMap.width, height: staticMap.height,
    coordinate_system: 'game map units; origin top-left; +x right; +y down', provinces: geometry }),
  output('geometry/terrain_marker_positions.json', { province_count_with_explicit_markers: provinces.filter((p) => p.tmp?.length).length,
    marker_count: markers.length, markers }),
  output('geometry/province_centers.json', { count: provinces.length,
    centers: provinces.map((p) => ({ province_id: p.id, name: names.get(p.id), x: p.c.x, y: p.c.y })) }),
  output('geometry/sea_points.json', { count: seaPoints.length,
    sea_points: seaPoints.map((p) => ({ sea_point_id: p.id, name: names.get(p.id), x: p.c.x, y: p.c.y,
      ed_raw: p.ed ?? 0, hst_raw: p.hst ?? 0, pal_raw: p.pal ?? 0 })) }),
  output('metadata/provinces.json', { count: provinces.length, provinces: provinceMetadata }),
  output('metadata/countries.json', { count: countries.length, countries }),
  output('metadata/terrain_types.json', { terrain_types: terrainNames }),
  output('metadata/resource_types.json', { resource_types: resourceTypes }),
  output('metadata/province_resource_production.json', { resource_ids: resourceIds, resource_names: resourceTypes,
    provinces: provinces.map((p) => ({ province_id: p.id, name: names.get(p.id),
      resource_1_food: p.cp?.[1] ?? 0, resource_3_manpower: p.cp?.[3] ?? 0,
      resource_4_metal: p.cp?.[4] ?? 0, resource_5_oil: p.cp?.[5] ?? 0,
      resource_20_money: p.cp?.[20] ?? 0 })) }),
  output('metadata/regions.json', { count: 0, regions: [] }),
  output('metadata/province_region_membership.json', { count: 0, memberships: [] }),
  output('metadata/initial_ownership.json', { count: ownership.length,
    verification: { core_matches_captured_owner: ownership.filter((o) => o.core_matches_captured_owner).length }, ownership }),
  output('metadata/map_metadata.json', { map_id: staticMap.mapID, map_version: staticMap.version,
    width: staticMap.width, height: staticMap.height, overlap_x: staticMap.overlapX,
    population_factor: staticMap.populationFactor, use_population: staticMap.usePopulation,
    province_count: provinces.length, sea_point_count: seaPoints.length,
    country_count_initial_ownership: countries.length }),
  output('topology/logical_border_segments.json', { segment_count: borders.length, segments: borders }),
  output('topology/province_adjacency.json', { adjacency_pair_count: adjacency.size, adjacencies: [...adjacency.values()] }),
  output('movement/connection_segments.json', { decoder: { record_bytes: 24, endianness: 'big',
    fields: ['location_id:int32', 'type:int32', 'x1:int32/100', 'y1:int32/100', 'x2:int32/100', 'y2:int32/100'] }, segments: connections }),
  output('movement/network_nodes.json', { nodes }),
]);
console.log(`Extracted Europe: ${provinces.length} provinces, ${countries.length} countries, ${connections.length} connections.`);
