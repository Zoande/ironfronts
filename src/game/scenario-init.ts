/**
 * Deterministic scenario initialisation.
 *
 * Pure: `(selection, scenario, world) -> GameState`. Same inputs always produce
 * the same starting game — starting buildings, armies and stockpiles are seeded
 * from `world` + the scenario id, never random per run.
 *
 * Phase A builds the static starting state. The per-tick systems (movement,
 * extraction, production, combat) live in `game-session.ts` and later phases;
 * this file only lays out turn 0.
 */

import type { ScenarioDef, ScenarioSelection } from './scenario';
import type { WorldData, WorldProvince } from './world-data';
import type {
  ControllerType, CountryState, GameState, ProductionOrder, ProvinceBuildings,
} from './game-state';
import { GAME_STATE_VERSION, emptyStockpile } from './game-state';
import type { ArmyStack, UnitGroup } from './units/army';
import { makeGroup } from './units/army';
import { buildLandGraph, nearestNode, type LandGraph } from './movement/graph';
import { wrappedDistance } from './geometry';
import { mulberry32, hashString } from './rng';
import { bootstrapResources, type ResourceBootstrapResult } from './resource-bootstrap';

/**
 * Every selectable (five-city) country starts on this identical footing.
 *
 * Deliberately lean: the opening economy should force real choices (build vs.
 * mobilise vs. bank) in the first weeks rather than letting a player queue
 * everything at once. Roughly a third of the earlier prototype values. Sandbox
 * keeps its own huge stockpile below.
 */
export const SELECTABLE_START_STOCKPILE = {
  funds: 650, manpower: 450, food: 300, stone: 110, metal: 150, oil: 90,
};
export const MINOR_START_STOCKPILE = {
  funds: 400, manpower: 300, food: 220, stone: 75, metal: 95, oil: 55,
};
const SANDBOX_STOCKPILE = {
  funds: 99_999, manpower: 99_999, food: 99_999, stone: 99_999, metal: 99_999, oil: 99_999,
};

const SELECTABLE_CAPITAL_ARMY: Array<{ typeId: string; count: number }> = [
  { typeId: 'infantry', count: 4 },
  { typeId: 'engineer', count: 2 },
];
const SELECTABLE_CITY_ARMY: Array<{ typeId: string; count: number }> = [
  { typeId: 'infantry', count: 2 },
  { typeId: 'armored-car', count: 1 },
];
const MINOR_CITY_ARMY: Array<{ typeId: string; count: number }> = [
  { typeId: 'infantry', count: 3 },
];

export interface InitResult {
  readonly state: GameState;
  /** Kept out of GameState (rebuilt on load); systems read it from the session. */
  readonly graph: LandGraph;
  /** Diagnostics for the report / tests. */
  readonly diagnostics: {
    readonly eligibleCountryIds: readonly number[];
    readonly reachableResourceNodes: number;
    readonly unreachableResourceNodes: number;
    readonly guaranteedDeposits: ResourceBootstrapResult['guarantees'];
    readonly totalArmies: number;
    readonly startCameras: Readonly<Record<number, { readonly x: number; readonly z: number; readonly distance: number }>>;
  };
}

function provincesByOwner(world: WorldData): Map<number, WorldProvince[]> {
  const byOwner = new Map<number, WorldProvince[]>();
  for (const province of world.provinces) {
    const owner = world.provinceOwner(province.id);
    if (!owner) continue;
    (byOwner.get(owner) ?? byOwner.set(owner, []).get(owner)!).push(province);
  }
  return byOwner;
}

function makeCountryState(
  world: WorldData, countryId: number, controller: ControllerType, sandbox: boolean, selectable: boolean,
): CountryState {
  const record = world.countries.find((country) => country.id === countryId);
  const stockpile = sandbox
    ? { ...SANDBOX_STOCKPILE }
    : { ...(selectable ? SELECTABLE_START_STOCKPILE : MINOR_START_STOCKPILE) };
  return {
    id: countryId,
    name: record?.name ?? `Country ${countryId}`,
    color: record?.color ?? '#888888',
    controller,
    stockpile,
    income: emptyStockpile(),
    industryCapacity: selectable ? 10 : 6,
  };
}

/** Deterministically choose which urban provinces get which starting building:
 *  the capital always gets a barracks + tank plant; the next cities get one
 *  building each, cycling barracks -> ordnance -> barracks so the player has a
 *  real choice about what to expand. */
function assignStartingBuildings(
  cities: WorldProvince[], capitalId: number,
): Map<number, ProvinceBuildings> {
  const out = new Map<number, ProvinceBuildings>();
  const ordered = [...cities].sort((a, b) => b.population - a.population);
  ordered.forEach((province, index) => {
    const buildings: ProvinceBuildings = { barracks: 0, tankPlant: 0, ordnance: 0 };
    if (province.id === capitalId) {
      buildings.barracks = 1;
      buildings.tankPlant = 1;
    } else if (index === 1) {
      buildings.barracks = 1;
    } else if (index === 2) {
      buildings.ordnance = 1;
    } else if (index === 3) {
      buildings.barracks = 1;
    } else {
      return;
    }
    out.set(province.id, buildings);
  });
  return out;
}

function spawnArmy(
  id: string, ownerCountryId: number, name: string, province: WorldProvince,
  graph: LandGraph, component: number,
  composition: Array<{ typeId: string; count: number }>,
): ArmyStack | null {
  const nodeId = nearestNode(
    graph, province.center[0], province.center[1], 400, component,
  );
  if (nodeId < 0) return null;
  const units: UnitGroup[] = composition.map((entry) => makeGroup(entry.typeId, entry.count));
  return {
    id,
    ownerCountryId,
    name,
    x: graph.nodeX[nodeId],
    z: graph.nodeZ[nodeId],
    graphNodeId: nodeId,
    units,
    status: 'idle',
    order: null,
    extractingNodeId: null,
  };
}

export function initGameState(
  selection: ScenarioSelection,
  scenario: ScenarioDef,
  world: WorldData,
): InitResult {
  const sandbox = scenario.mode === 'sandbox';
  const seed = hashString(scenario.id);
  const random = mulberry32(seed);

  const graph = buildLandGraph(world.connections, world.width, world.height);

  // ---- countries ---------------------------------------------------------
  // ControllerType is authoritative. Checkpoint 1: the player's country
  // is 'player', every other country is 'neutral'. A later phase promotes one
  // nearby hostile country to 'ai'.
  const byOwner = provincesByOwner(world);
  const eligibleCountryIds = [...byOwner]
    .filter(([, provinces]) => provinces.filter((province) => province.urban).length >= scenario.minimumStartingCities)
    .map(([countryId]) => countryId)
    .sort((a, b) => a - b);
  const eligible = new Set(eligibleCountryIds);
  const initializationCountryId = eligibleCountryIds[0] ?? byOwner.keys().next().value ?? 0;
  const countries: Record<number, CountryState> = {};
  for (const countryId of byOwner.keys()) {
    countries[countryId] = makeCountryState(
      world, countryId, 'neutral', sandbox, eligible.has(countryId),
    );
  }
  if (Object.keys(countries).length === 0) {
    // Player country has no territory in this world — caller should have
    // validated, but fail loud rather than produce a broken game.
    throw new Error(
      'World at War has no countries with territory.',
    );
  }

  // ---- province ownership (dense) --------------------------------------
  const provinceOwners: Record<number, number> = {};
  for (const province of world.provinces) {
    provinceOwners[province.id] = world.provinceOwner(province.id);
  }

  // ---- player component (the reachable mainland for this player) -------
  const playerProvinces = byOwner.get(initializationCountryId) ?? [];
  const capital = world.countries.find(
    (country) => country.id === initializationCountryId,
  )?.capitalProvinceId ?? playerProvinces[0]?.id ?? -1;
  const capitalProvince = world.provinces.find((province) => province.id === capital)
    ?? playerProvinces[0];
  const componentVotes = new Map<number, number>();
  for (const province of playerProvinces) {
    const node = nearestNode(graph, province.center[0], province.center[1], 400);
    if (node < 0) continue;
    const comp = graph.component[node];
    componentVotes.set(comp, (componentVotes.get(comp) ?? 0) + 1);
  }
  let playerComponent = -1;
  let bestVotes = -1;
  for (const [comp, votes] of componentVotes) {
    if (votes > bestVotes) { bestVotes = votes; playerComponent = comp; }
  }

  // ---- starting buildings (player + a few AI, urban only) -------------
  const provinceBuildings: Record<number, ProvinceBuildings> = {};
  const playerCities = playerProvinces.filter((province) => province.urban);
  for (const [provinceId, buildings] of assignStartingBuildings(playerCities, capital)) {
    provinceBuildings[provinceId] = buildings;
  }
  for (const [ownerId, provinces] of byOwner) {
    if (ownerId === initializationCountryId) continue;
    const cities = provinces.filter((province) => province.urban)
      .sort((a, b) => b.population - a.population);
    if (eligible.has(ownerId)) {
      const capitalId = world.countries.find((country) => country.id === ownerId)?.capitalProvinceId
        ?? cities[0]?.id ?? -1;
      for (const [provinceId, buildings] of assignStartingBuildings(cities, capitalId)) {
        provinceBuildings[provinceId] = buildings;
      }
    } else if (cities[0]) {
      provinceBuildings[cities[0].id] = { barracks: 1, tankPlant: 0, ordnance: 0 };
    }
  }

  // ---- resource nodes: point-in-province assignment + strategic baseline
  // The baseline stone+metal guarantee runs ONLY for the participants that need
  // an economy — at init that is just the selected player. An AI opponent gets
  // its own guarantee when `GameSession` flips it on (enableNearbyAi); a
  // multiplayer server would call `guaranteeStrategicBaseline` per participant.
  // Every other neutral nation keeps whatever scarce natural geography it has.
  const participantIds = sandbox ? [] : eligibleCountryIds;
  const bootstrap = bootstrapResources(
    world.resourceNodes, world, graph, provinceOwners, participantIds, seed,
  );
  const resourceNodes = bootstrap.nodes;

  // ---- starting armies ----------------------------------------
  const armies: Record<string, ArmyStack> = {};
  let nextArmyId = 1;
  const addArmy = (
    ownerId: number, name: string, province: WorldProvince, component: number,
    composition: Array<{ typeId: string; count: number }>,
  ): void => {
    const army = spawnArmy(
      `army-${nextArmyId}`, ownerId, name, province, graph, component, composition,
    );
    if (!army) return;
    armies[army.id] = army;
    nextArmyId += 1;
  };

  if (capitalProvince) {
    addArmy(initializationCountryId, '1st Army', capitalProvince, playerComponent, SELECTABLE_CAPITAL_ARMY);
  }
  const playerCityTargets = [...playerCities]
    .filter((province) => province.id !== capital)
    .sort((a, b) => b.population - a.population)
    .slice(0, 3);
  playerCityTargets.forEach((province, index) => {
    addArmy(
      initializationCountryId, `${index + 2}${ordinalSuffix(index + 2)} Army`,
      province, playerComponent, SELECTABLE_CITY_ARMY,
    );
  });

  if (!sandbox) {
    for (const [ownerId, provinces] of byOwner) {
      if (ownerId === initializationCountryId) continue;
      const cities = provinces.filter((province) => province.urban)
        .sort((a, b) => b.population - a.population);
      const ownerComponent = cities[0]
        ? graph.component[nearestNode(graph, cities[0].center[0], cities[0].center[1], 400)] ?? -1
        : -1;
      const limit = eligible.has(ownerId) ? 4 : 2;
      cities.slice(0, limit).forEach((province, index) => {
        addArmy(ownerId, index === 0 && eligible.has(ownerId) ? '1st Army' : `${province.id} Garrison`, province, ownerComponent,
          eligible.has(ownerId)
            ? (index === 0 ? SELECTABLE_CAPITAL_ARMY : SELECTABLE_CITY_ARMY)
            : (index === 0 ? MINOR_CITY_ARMY : [{ typeId: 'infantry', count: 2 }]));
      });
    }
  }
  void random; // reserved for future jitter in OOB placement

  const productionQueues: Record<number, ProductionOrder[]> = {};

  const state: GameState = {
    version: GAME_STATE_VERSION,
    seed,
    scenarioId: scenario.id,
    mode: scenario.mode,
    fogOfWar: scenario.fogOfWar && !sandbox,
    economyEnabled: scenario.economyEnabled && !sandbox,
    clock: { gameTimeHours: 0, startDate: selection.startDate },
    simulationTick: 0,
    countries,
    provinceOwners,
    provinceBuildings,
    productionQueues,
    constructionQueues: {},
    rallyPoints: {},
    armies,
    battles: {},
    battleFronts: {},
    resourceNodes,
    relations: {},
    nextArmyId,
    nextBattleId: 1,
    nextOrderId: 1,
    nextEventId: 1,
  };

  const startCamera = computeStartCamera(
    world, playerProvinces, playerComponent, graph, capitalProvince,
  );
  const startCameras: Record<number, { x: number; z: number; distance: number }> = {
    [initializationCountryId]: startCamera,
  };
  for (const countryId of eligibleCountryIds) {
    if (countryId === initializationCountryId) continue;
    const provinces = byOwner.get(countryId) ?? [];
    const componentVotes = new Map<number, number>();
    for (const province of provinces) {
      const node = nearestNode(graph, province.center[0], province.center[1], 400);
      if (node >= 0) componentVotes.set(graph.component[node], (componentVotes.get(graph.component[node]) ?? 0) + 1);
    }
    let component = -1;
    let votes = -1;
    for (const [candidate, count] of componentVotes) {
      if (count > votes) { component = candidate; votes = count; }
    }
    const capitalId = world.countries.find((country) => country.id === countryId)?.capitalProvinceId;
    const countryCapital = world.provinces.find((province) => province.id === capitalId);
    startCameras[countryId] = computeStartCamera(world, provinces, component, graph, countryCapital);
  }

  return {
    state,
    graph,
    diagnostics: {
      eligibleCountryIds,
      reachableResourceNodes: bootstrap.diagnostics.reachable,
      unreachableResourceNodes: bootstrap.diagnostics.unreachable,
      guaranteedDeposits: bootstrap.guarantees,
      totalArmies: Object.keys(armies).length,
      startCameras,
    },
  };
}

/**
 * Frame the player's homeland (camera). Uses the population-weighted centroid
 * of the provinces on the reachable mainland (so far-flung island exclaves do
 * not drag the view off the country), and an orbit distance sized to the
 * territory's extent so the nation reads clearly and fills most of the view
 * without starting zoomed out. Falls back to the capital, then world centre.
 */
function computeStartCamera(
  world: WorldData,
  playerProvinces: readonly WorldProvince[],
  playerComponent: number,
  graph: LandGraph,
  capitalProvince: WorldProvince | undefined,
): { x: number; z: number; distance: number } {
  const onMainland = playerProvinces.filter((province) => {
    const node = nearestNode(graph, province.center[0], province.center[1], 400);
    return node >= 0 && graph.component[node] === playerComponent;
  });
  const framed = onMainland.length > 0 ? onMainland : playerProvinces;
  if (framed.length === 0) {
    return capitalProvince
      ? { x: capitalProvince.center[0], z: capitalProvince.center[1], distance: 1_400 }
      : { x: world.width / 2, z: world.height / 2, distance: 3_000 };
  }

  let weightSum = 0;
  let cx = 0;
  let cz = 0;
  for (const province of framed) {
    const weight = Math.max(1, province.population);
    weightSum += weight;
    cx += province.center[0] * weight;
    cz += province.center[1] * weight;
  }
  cx /= weightSum;
  cz /= weightSum;

  // Extent = 90th-percentile spread from the centroid, so one stray province
  // does not blow up the zoom.
  const spreads = framed
    .map((p) => wrappedDistance(cx, cz, p.center[0], p.center[1], world.width))
    .sort((a, b) => a - b);
  const extent = spreads[Math.floor(spreads.length * 0.9)] ?? spreads[spreads.length - 1] ?? 400;

  // Distance tuned so the homeland occupies most of the frame at the default
  // orbit pitch. Clamped to sane bounds.
  const distance = Math.min(3_200, Math.max(620, extent * 2.4 + 260));
  return { x: cx, z: cz, distance };
}

function ordinalSuffix(value: number): string {
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  switch (value % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}
