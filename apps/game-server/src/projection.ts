import {
  extractionEligibility, movementEdgeAllowed, computeArmyVisibility, projectArmyView,
  currentMovementLeg, legalRetreatPaths, nearestNode, findPath,
  UNIT_TYPES, BUILDINGS, buildOptions, producibleUnits, armyShortageSummary,
  provinceResourceOutputBreakdown,
  buildEngineerAssignmentIndex, engineerAssignmentKey,
  unitProductionWorkRate,
  type GameState, type LandGraph, type WorldData,
} from '@ironfronts/game-core';
import type { PlayerProjection, ProjectionDelta, PublicCountry } from '@ironfronts/protocol';

export function projectFor(
  state: GameState, world: WorldData, graph: LandGraph, viewerCountryId: number,
  gameHoursPerRealSecond = 1 / 3_600, sampledAtEpochMs = Date.now(),
  debugPotential = false,
): PlayerProjection {
  const aliveCountries = new Set(Object.values(state.provinceOwners));
  const countries: Record<number, PublicCountry> = {};
  for (const country of Object.values(state.countries)) {
    countries[country.id] = {
      id: country.id,
      name: country.name,
      color: country.color,
      controller: country.controller,
      alive: aliveCountries.has(country.id),
    };
  }
  const ownProvince = (id: string): boolean => state.provinceOwners[Number(id)] === viewerCountryId;
  const privateMap = <T>(source: Record<number, T>): Record<number, T> => Object.fromEntries(
    Object.entries(source).filter(([id]) => ownProvince(id)),
  ) as Record<number, T>;
  const visibility = computeArmyVisibility(state, world, viewerCountryId);
  const armies = Object.fromEntries(Object.keys(state.armies).flatMap((armyId) => {
    const army = projectArmyView(
      state, world, viewerCountryId, armyId, visibility, gameHoursPerRealSecond,
    );
    if (!army) return [];
    let projected: import('@ironfronts/protocol').ProjectedArmy = army;
    if (graph && army.own) {
      const eligibility = extractionEligibility({ state, world, graph }, army.id);
      projected = { ...projected, actions: { canExtract: eligibility.ok, extractionProvinceId: eligibility.provinceId ?? null,
        extractableResources: [...(eligibility.resources ?? [])],
        ...(eligibility.reason ? { extractReason: eligibility.reason } : {}) },
        shortage: {
          severity: { ...(state.armies[army.id]?.shortageSeverity ?? { funds: 0, food: 0, metal: 0, oil: 0 }) },
          modifiers: armyShortageSummary(state.armies[army.id]),
        } };
    }
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
    if (graph && army.status !== 'unknown' && gameHoursPerRealSecond > 0) {
      const source = state.armies[army.id];
      const leg = source ? currentMovementLeg({ state, world, graph }, source) : null;
      if (leg && leg.worldUnitsPerGameHour > 0) {
        const route = source!.order ? orderRouteForClient(source!.order, graph, source!.x, source!.z) ?? undefined : undefined;
        projected = {
          ...projected,
          motion: {
            sampledAtEpochMs, generation: state.clock.generation ?? 0,
            targetX: leg.targetX,
            targetZ: leg.targetZ,
            route,
            durationMs: leg.distance / (leg.worldUnitsPerGameHour * gameHoursPerRealSecond) * 1_000,
          },
        };
      }
    }
    return [[army.id, projected]];
  }));
  const own = state.countries[viewerCountryId];
  const owned = world.provinces.filter((province) => state.provinceOwners[province.id] === viewerCountryId);
  const provinceActions = Object.fromEntries(owned.map((province) => {
    const productionAvailable = new Set(producibleUnits({ state, world, graph: graph! }, province.id, viewerCountryId));
    const constructionOptions = new Map(buildOptions({ state, world, graph: graph! }, province.id, viewerCountryId).map((option) => [option.id, option]));
    return [province.id, {
      production: UNIT_TYPES.filter((unit) => productionAvailable.has(unit.id)).map((unit) => {
        const available = productionAvailable.has(unit.id);
        const affordable = Object.entries(unit.buildCost).every(([key, value]) => (own?.stockpile[key as keyof typeof own.stockpile] ?? 0) >= (value ?? 0));
        return { unitTypeId: unit.id, available, affordable,
          ...(!available ? { reason: `Requires a ${unit.requiredBuilding}.` } : !affordable ? { reason: 'Insufficient resources.' } : {}) };
      }),
      construction: Object.keys(BUILDINGS).map((buildingId) => {
        const id = buildingId as keyof typeof BUILDINGS;
        const option = constructionOptions.get(id);
        return { buildingId: id, available: Boolean(option && !option.reason), affordable: option?.affordable ?? false,
          targetTier: option?.targetTier,
          ...(option?.reason ? { reason: option.reason } : {}) };
      }),
      canSetRally: Boolean(graph), ...(!graph ? { rallyReason: 'Movement network unavailable.' } : {}),
      // Anti-snowball economy penalty (see economy.ts) — surfaced here so the
      // player can see *why* a captured city's output is discounted.
      occupied: world.provinceOwner(province.id) !== 0 && world.provinceOwner(province.id) !== viewerCountryId,
    }];
  }));
  const capitalId = world.countries.find((country) => country.id === viewerCountryId)?.capitalProvinceId;
  const capital = world.provinces.find((province) => province.id === capitalId) ?? owned[0];
  const diplomacy = {
    messages: Object.values(state.diplomacyMessages ?? {})
      .filter((message) => message.fromCountryId === viewerCountryId || message.toCountryId === viewerCountryId)
      .map((message) => ({ ...message }))
      .sort((a, b) => a.sentAtTick - b.sentAtTick || a.id.localeCompare(b.id)),
    proposals: Object.values(state.diplomacyProposals ?? {})
      .filter((proposal) => proposal.fromCountryId === viewerCountryId || proposal.toCountryId === viewerCountryId)
      .map((proposal) => ({ ...proposal }))
      .sort((a, b) => a.createdAtTick - b.createdAtTick || a.id.localeCompare(b.id)),
  };
  const visibleEconomies = debugPotential ? (state.provinceEconomies ?? {}) : privateMap(state.provinceEconomies ?? {});
  const engineerAssignments = buildEngineerAssignmentIndex({ state, world, graph });
  const provinceEconomies = Object.fromEntries(Object.entries(visibleEconomies).map(([rawId, economy]) => {
    const provinceId = Number(rawId);
    return [provinceId, {
      ...economy,
      productionBreakdown: Object.fromEntries((['food', 'stone', 'metal', 'oil'] as const)
        .map((resource) => [resource, provinceResourceOutputBreakdown(
          { state, world, graph }, provinceId, resource, economy,
          engineerAssignments.get(engineerAssignmentKey(provinceId, resource)) ?? 0,
        )])),
    }];
  }));
  const productionQueues = Object.fromEntries(Object.entries(privateMap(state.productionQueues)).map(([rawId, queue]) => {
    const provinceId = Number(rawId);
    return [provinceId, queue.map((order) => ({ ...order,
      workRate: unitProductionWorkRate({ state, world, graph }, provinceId, order.unitTypeId) }))];
  }));
  return structuredClone({
    timeline: { elapsedSeconds: state.clock.gameTimeHours * 3_600, speed: gameHoursPerRealSecond * 3_600,
      sampledAtEpochMs, generation: state.clock.generation ?? 0 },
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
    // Exact potential outside owned land is privileged developer information.
    // Normal snapshots (including reconnects) only ever contain owned records.
    provinceEconomies,
    provinceActions,
    productionQueues,
    constructionQueues: privateMap(state.constructionQueues),
    rallyPoints: graph
      ? Object.fromEntries(Object.entries(privateMap(state.rallyPoints)).map(([id, point]) => [
        id, { ...point, route: rallyRouteForClient(world, graph, Number(id), point, state, viewerCountryId) ?? undefined },
      ]))
      : privateMap(state.rallyPoints),
    armies,
    ownCountry: own ? {
      id: own.id, name: own.name, color: own.color, controller: own.controller,
      stockpile: { ...own.stockpile }, income: { ...own.income }, industryCapacity: own.industryCapacity,
      upkeep: { ...(own.upkeep ?? {}) }, netIncome: { ...(own.netIncome ?? {}) },
      coverage: { ...(own.coverage ?? {}) }, reserveHours: { ...(own.reserveHours ?? {}) },
      shortages: structuredClone(own.shortages ?? {}),
      warheads: Math.floor(own.warheads ?? 0),
      phase: own.phase ?? 1,
      technologies: { infantry: 1, resources: 1, training: 1, hybrid: 1, armored: 1, ...(own.technologies ?? {}) },
      research: own.research ? { ...own.research } : undefined,
    } : null,
    relations: { ...state.relations },
    weather: state.weather ? { ...state.weather } : undefined,
    diplomacy,
    outcome: state.outcome ? { ...state.outcome } : undefined,
  });
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
  provinceId: number, rally: { x: number; z: number }, state: GameState, countryId: number,
): Array<{ x: number; z: number }> | null {
  const province = world.provinces.find((p) => p.id === provinceId);
  if (!province) return null;
  const from = nearestNode(graph, province.center[0], province.center[1], 600);
  if (from < 0) return null;
  const to = nearestNode(graph, rally.x, rally.z, 600, graph.component[from]);
  if (to < 0) return null;
  const path = findPath(graph, from, to, movementEdgeAllowed({ state, world, graph }, countryId));
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
  'constructionQueues', 'provinceEconomies', 'provinceActions', 'rallyPoints', 'armies', 'relations',
] as const;

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function diffProjection(previous: PlayerProjection, next: PlayerProjection): ProjectionDelta | null {
  const delta: ProjectionDelta = { changed: {}, upserts: {}, removals: {}, redactions: [] };
  if (previous.simulationTick !== next.simulationTick) delta.changed.simulationTick = next.simulationTick;
  if (previous.simulationTick !== next.simulationTick || previous.timeline?.speed !== next.timeline?.speed
    || previous.timeline?.generation !== next.timeline?.generation) {
    delta.changed.timeline = next.timeline;
  }
  if (!same(previous.ownCountry, next.ownCountry)) delta.changed.ownCountry = next.ownCountry;
  if (!same(previous.weather, next.weather)) delta.changed.weather = next.weather;
  if (!same(previous.diplomacy, next.diplomacy)) delta.changed.diplomacy = next.diplomacy;
  if (!same(previous.outcome, next.outcome)) delta.changed.outcome = next.outcome;
  for (const key of COLLECTIONS) {
    const before = (previous[key] ?? {}) as Record<string, unknown>;
    const after = (next[key] ?? {}) as Record<string, unknown>;
    const upserts: Record<string, unknown> = {};
    const removals: string[] = [];
    for (const [id, value] of Object.entries(after)) {
      if (!(id in before) || !same(before[id], value)) upserts[id] = value;
    }
    for (const id of Object.keys(before)) {
      if (!(id in after)) {
        removals.push(id);
        if (key === 'armies' || key === 'provinceEconomies') delta.redactions.push(`${key}.${id}`);
      }
    }
    if (Object.keys(upserts).length) delta.upserts[key] = upserts;
    if (removals.length) delta.removals[key] = removals;
  }
  return Object.keys(delta.changed).length || Object.keys(delta.upserts).length || Object.keys(delta.removals).length
    ? delta : null;
}
