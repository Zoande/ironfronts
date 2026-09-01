import {
  computeArmyVisibility, projectArmyView, visibleResourceNodes,
  legalRetreatPaths, stackExtractionRate, nearestNode, findPath,
  type GameState, type LandGraph, type WorldData,
} from '@ironfronts/game-core';
import type { PlayerProjection, ProjectionDelta, PublicCountry } from '@ironfronts/protocol';

export function projectFor(
  state: GameState, world: WorldData, graphOrViewer: LandGraph | number, viewerId?: number,
): PlayerProjection {
  const graph = typeof graphOrViewer === 'number' ? null : graphOrViewer;
  const viewerCountryId = typeof graphOrViewer === 'number' ? graphOrViewer : viewerId!;
  const countries: Record<number, PublicCountry> = {};
  for (const country of Object.values(state.countries)) {
    countries[country.id] = {
      id: country.id,
      name: country.name,
      color: country.color,
      controller: country.controller,
      alive: Object.values(state.provinceOwners).some((owner) => owner === country.id),
    };
  }
  const ownProvince = (id: string): boolean => state.provinceOwners[Number(id)] === viewerCountryId;
  const privateMap = <T>(source: Record<number, T>): Record<number, T> => Object.fromEntries(
    Object.entries(source).filter(([id]) => ownProvince(id)),
  ) as Record<number, T>;
  const visibility = computeArmyVisibility(state, world, viewerCountryId);
  const armies = Object.fromEntries(Object.keys(state.armies).flatMap((armyId) => {
    const army = projectArmyView(state, world, viewerCountryId, armyId, visibility);
    if (!army) return [];
    let projected = army;
    if (graph && army.own && army.status === 'engaged') {
      projected = {
        ...projected,
        legalRetreatExits: retreatExitsForClient(
          legalRetreatPaths({ state, world, graph }, army.id), graph, world.width, army.x, army.z,
        ),
      };
    }
    if (graph && army.own) {
      const order = state.armies[army.id]?.order;
      const route = order && orderRouteForClient(order, graph, army.x, army.z);
      if (route) projected = { ...projected, moveRoute: route, moveIntent: order!.intent };
    }
    return [[army.id, projected]];
  }));
  const resourceNodes = Object.fromEntries(
    visibleResourceNodes(state, world, viewerCountryId).map((node) => [node.id, node]),
  );
  const own = state.countries[viewerCountryId];
  // Live per-game-hour extraction rate for the viewer's own stacks, by resource
  // kind. The passive `income` map only covers funds/manpower/food; stone/metal/
  // oil come from physical extraction, so the HUD needs this to show a rate.
  const extraction = { stone: 0, metal: 0, oil: 0 };
  for (const army of Object.values(state.armies)) {
    if (army.ownerCountryId !== viewerCountryId || army.status !== 'extracting') continue;
    if (army.extractingNodeId === null) continue;
    const node = state.resourceNodes[army.extractingNodeId];
    if (!node || node.status !== 'extracting' || node.remaining <= 0) continue;
    if (node.kind === 'stone' || node.kind === 'metal' || node.kind === 'oil') {
      extraction[node.kind] += stackExtractionRate(army);
    }
  }
  const owned = world.provinces.filter((province) => state.provinceOwners[province.id] === viewerCountryId);
  const capitalId = world.countries.find((country) => country.id === viewerCountryId)?.capitalProvinceId;
  const capital = world.provinces.find((province) => province.id === capitalId) ?? owned[0];
  return {
    simulationTick: state.simulationTick,
    viewerCountryId,
    startCamera: homelandCamera(
      owned.map((province) => province.center),
      capital?.center ?? null,
      world.width, world.height,
    ),
    countries,
    provinceOwners: { ...state.provinceOwners },
    provinceBuildings: privateMap(state.provinceBuildings),
    productionQueues: privateMap(state.productionQueues),
    constructionQueues: privateMap(state.constructionQueues),
    rallyPoints: graph
      ? Object.fromEntries(Object.entries(privateMap(state.rallyPoints)).map(([id, point]) => [
        id, { ...point, route: rallyRouteForClient(world, graph, Number(id), point) ?? undefined },
      ]))
      : privateMap(state.rallyPoints),
    armies,
    resourceNodes,
    ownCountry: own ? {
      id: own.id, name: own.name, color: own.color, controller: own.controller,
      stockpile: { ...own.stockpile }, income: { ...own.income }, industryCapacity: own.industryCapacity,
      extraction,
    } : null,
    relations: { ...state.relations },
  };
}

/**
 * Frame the player's whole homeland at spawn, not just the capital: centre on
 * the owned-province centroid (nudged toward the capital so it stays in shot)
 * and pull the camera back to fit the homeland's larger axis. Handles the
 * world-x seam by unwrapping every province around an anchor. Falls back to the
 * capital, then the map centre, when a country holds no provinces.
 */
export function homelandCamera(
  ownedCenters: ReadonlyArray<readonly [number, number] | readonly number[]>,
  capitalCenter: readonly number[] | null,
  worldWidth: number, worldHeight: number,
): { x: number; z: number; distance: number } {
  if (!ownedCenters.length) {
    return capitalCenter
      ? { x: capitalCenter[0], z: capitalCenter[1], distance: 1_600 }
      : { x: worldWidth / 2, z: worldHeight / 2, distance: 3_000 };
  }
  const anchorX = capitalCenter?.[0] ?? ownedCenters[0][0];
  const unwrap = (x: number): number => {
    let d = x - anchorX;
    if (d > worldWidth / 2) d -= worldWidth;
    else if (d < -worldWidth / 2) d += worldWidth;
    return anchorX + d;
  };
  let sumX = 0;
  let sumZ = 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const center of ownedCenters) {
    const ux = unwrap(center[0]);
    sumX += ux;
    sumZ += center[1];
    minX = Math.min(minX, ux);
    maxX = Math.max(maxX, ux);
    minZ = Math.min(minZ, center[1]);
    maxZ = Math.max(maxZ, center[1]);
  }
  const centroidX = sumX / ownedCenters.length;
  const centroidZ = sumZ / ownedCenters.length;
  // Keep the capital comfortably in frame by biasing the look-at toward it.
  const x = capitalCenter ? centroidX * 0.68 + unwrap(capitalCenter[0]) * 0.32 : centroidX;
  const z = capitalCenter ? centroidZ * 0.68 + capitalCenter[1] * 0.32 : centroidZ;
  const span = Math.max(maxX - minX, maxZ - minZ);
  const distance = Math.min(4_200, Math.max(1_100, span * 0.95 + 700));
  return {
    x: ((x % worldWidth) + worldWidth) % worldWidth,
    z, distance,
  };
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** 8-point compass label for a world-space delta (north is -z, east is +x). */
export function bearingLabel(dx: number, dz: number): string {
  const deg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const index = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return COMPASS[index];
}

/**
 * `legalRetreatPaths` returns one route per (escape edge x owned province) pair,
 * which for a large country is dozens of entries that all mean the same thing to
 * the player: break contact through this edge. Collapse them to the distinct
 * first nodes (the list is already shortest-first, so the first hit per node is
 * the nearest safe destination) and tag each with a compass bearing so the UI
 * can offer "withdraw NE / withdraw S" instead of 25 numbered buttons.
 */
/**
 * World-space polyline for an own army's active order: its live position, then
 * every remaining road-graph node up to the destination. Returns null when the
 * order carries no path (e.g. an already-arrived order still being cleaned up).
 */
export function orderRouteForClient(
  order: { path: readonly number[] },
  graph: { nodeX: ArrayLike<number>; nodeZ: ArrayLike<number> },
  armyX: number, armyZ: number,
): Array<{ x: number; z: number }> | null {
  if (!order.path.length) return null;
  return [
    { x: armyX, z: armyZ },
    ...Array.from(order.path, (nodeId) => ({ x: graph.nodeX[nodeId], z: graph.nodeZ[nodeId] })),
  ];
}

/**
 * Road polyline from a province's own movement node to its rally point, using
 * the same planner a freshly produced unit walks. First point is the province
 * node so the client can draw it without knowing province centres. Null when the
 * province, its node, or a path can't be resolved.
 */
export function rallyRouteForClient(
  world: WorldData, graph: LandGraph,
  provinceId: number, rally: { x: number; z: number },
): Array<{ x: number; z: number }> | null {
  const province = world.provinces.find((p) => p.id === provinceId);
  if (!province) return null;
  const from = nearestNode(graph, province.center[0], province.center[1], 600);
  if (from < 0) return null;
  const to = nearestNode(graph, rally.x, rally.z, 600, graph.component[from]);
  if (to < 0) return null;
  const path = findPath(graph, from, to);
  if (!path || path.length < 2) return null;
  return path.map((nodeId) => ({ x: graph.nodeX[nodeId], z: graph.nodeZ[nodeId] }));
}

export function retreatExitsForClient(
  routes: ReadonlyArray<{ firstNodeId: number; destinationProvinceId: number }>,
  graph: { nodeX: ArrayLike<number>; nodeZ: ArrayLike<number> },
  worldWidth: number, armyX: number, armyZ: number,
): Array<{ firstNodeId: number; destinationProvinceId: number; x: number; z: number; bearing: string }> {
  const seen = new Set<number>();
  const exits: Array<{ firstNodeId: number; destinationProvinceId: number; x: number; z: number; bearing: string }> = [];
  for (const route of routes) {
    if (seen.has(route.firstNodeId)) continue;
    seen.add(route.firstNodeId);
    const x = graph.nodeX[route.firstNodeId];
    const z = graph.nodeZ[route.firstNodeId];
    let dx = x - armyX;
    if (dx > worldWidth / 2) dx -= worldWidth;
    if (dx < -worldWidth / 2) dx += worldWidth;
    exits.push({
      firstNodeId: route.firstNodeId,
      destinationProvinceId: route.destinationProvinceId,
      x, z, bearing: bearingLabel(dx, z - armyZ),
    });
  }
  return exits;
}

const COLLECTIONS = [
  'countries', 'provinceOwners', 'provinceBuildings', 'productionQueues',
  'constructionQueues', 'rallyPoints', 'armies', 'resourceNodes', 'relations',
] as const;

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function diffProjection(previous: PlayerProjection, next: PlayerProjection): ProjectionDelta | null {
  const delta: ProjectionDelta = { changed: {}, upserts: {}, removals: {}, redactions: [] };
  if (previous.simulationTick !== next.simulationTick) delta.changed.simulationTick = next.simulationTick;
  if (!same(previous.ownCountry, next.ownCountry)) delta.changed.ownCountry = next.ownCountry;
  for (const key of COLLECTIONS) {
    const before = previous[key] as Record<string, unknown>;
    const after = next[key] as Record<string, unknown>;
    const upserts: Record<string, unknown> = {};
    const removals: string[] = [];
    for (const [id, value] of Object.entries(after)) {
      if (!(id in before) || !same(before[id], value)) upserts[id] = value;
    }
    for (const id of Object.keys(before)) {
      if (!(id in after)) {
        removals.push(id);
        if (key === 'armies' || key === 'resourceNodes') delta.redactions.push(`${key}.${id}`);
      }
    }
    if (Object.keys(upserts).length) delta.upserts[key] = upserts;
    if (removals.length) delta.removals[key] = removals;
  }
  return Object.keys(delta.changed).length || Object.keys(delta.upserts).length || Object.keys(delta.removals).length
    ? delta : null;
}
