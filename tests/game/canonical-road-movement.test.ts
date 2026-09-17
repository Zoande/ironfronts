import { describe, expect, it } from 'vitest';
import { buildLandGraph, edgePositionFrom } from '../../src/game/movement/graph';
import { currentMovementLeg, remainingOrderTravelHours, stepMovement } from '../../src/game/units/movement';
import { makeGroup, type ArmyStack } from '../../src/game/units/army';
import { orderRouteForClient, roadRouteForClient } from '../../apps/game-server/src/projection';
import { GAME_STATE_VERSION, emptyStockpile, type GameState } from '../../src/game/game-state';
import { TERRAIN_CLASS, type CanonicalRoadNetwork, type WorldData } from '../../src/game/world-data';
import type { SimContext } from '../../src/game/sim-context';

const network: CanonicalRoadNetwork = {
  version: 1,
  nodes: [
    { id: 0, sourceNodeId: 10, x: 0, z: 0 },
    { id: 1, sourceNodeId: 11, x: 100, z: 100 },
  ],
  edges: [{ id: 0, from: 0, to: 1, length: 200, pointOffset: 0, pointCount: 3, dotted: true }],
  centerlines: Float32Array.from([0, 0, 0, 100, 100, 100]),
};

function context(): SimContext {
  const graph = buildLandGraph(new Float32Array(), 1_000, 500, network);
  const army: ArmyStack = {
    id: 'a', ownerCountryId: 1, name: 'A', x: 0, z: 0, graphNodeId: 0,
    units: [makeGroup('infantry', 3)], status: 'moving', extractingNodeId: null,
    order: { path: [1], destX: 100, destZ: 100, intent: 'move', edgeProgress: 0 },
  };
  const state = {
    version: GAME_STATE_VERSION, seed: 1, scenarioId: 'test', mode: 'campaign',
    fogOfWar: false, economyEnabled: false, clock: { gameTimeHours: 0, startDate: 'x' }, simulationTick: 0,
    countries: { 1: { id: 1, name: 'A', color: '#fff', controller: 'player', stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1 } },
    provinceOwners: { 1: 1 }, provinceBuildings: {}, productionQueues: {}, constructionQueues: {}, rallyPoints: {},
    armies: { a: army }, battles: {}, battleFronts: {}, resourceNodes: {}, provinceEconomies: {}, relations: {},
    nextArmyId: 2, nextBattleId: 1, nextFrontId: 1, nextOrderId: 1, nextEventId: 1,
  } as unknown as GameState;
  const world = {
    width: 1_000, height: 500, provinces: [{ id: 1, center: [50, 50], terrainId: 0, population: 1, coastal: false, urban: false }],
    countries: [{ id: 1, name: 'A', color: '#fff', capitalProvinceId: 1 }],
    provinceOwner: () => 1, provinceAt: () => 1, terrainClassAt: () => TERRAIN_CLASS.plain,
    connections: new Float32Array(), roadNetwork: network, resourceNodes: [],
  } as WorldData;
  return { state, world, graph };
}

describe('canonical road movement', () => {
  it('treats dotted centerlines as traversable and derives position from edge distance', () => {
    const ctx = context();
    const army = ctx.state.armies.a;
    expect(ctx.graph.adjacency[0]).toContain(1);
    expect(ctx.graph.edges[0].dotted).toBe(true);
    stepMovement(ctx, 0.01);
    expect(army.edge).toMatchObject({ edgeId: 0, from: 0, to: 1 });
    expect(army.x).toBeCloseTo(0, 8);
    expect(army.z).toBeGreaterThan(0);
    expect({ x: army.x, z: army.z }).toEqual(edgePositionFrom(
      ctx.graph, 0, 0, army.edge!.distanceAlongEdge!,
    ));
  });

  it('uses exact centerline length for the current leg, ETA, and client route', () => {
    const ctx = context();
    const army = ctx.state.armies.a;
    expect(currentMovementLeg(ctx, army)?.distance).toBe(200);
    expect(remainingOrderTravelHours(ctx, army)).toBeGreaterThan(0);
    expect(orderRouteForClient(army.order!, ctx.graph, army.x, army.z)).toEqual([
      { x: 0, z: 0 }, { x: 0, z: 100 }, { x: 100, z: 100 },
    ]);
    expect(roadRouteForClient(army.order!, ctx.graph, 0)).toEqual([
      { edgeId: 0, from: 0, to: 1, startDistance: 0 },
    ]);
  });

  it('captures an undefended enemy center crossed en route to a later target', () => {
    const roads: CanonicalRoadNetwork = {
      version: 1,
      nodes: [0, 1, 2].map((id) => ({ id, sourceNodeId: id, x: id * 100, z: 0 })),
      edges: [
        { id: 0, from: 0, to: 1, length: 100, pointOffset: 0, pointCount: 2, dotted: false },
        { id: 1, from: 1, to: 2, length: 100, pointOffset: 2, pointCount: 2, dotted: false },
      ],
      centerlines: Float32Array.from([0, 0, 100, 0, 100, 0, 200, 0]),
    };
    const base = context();
    const graph = buildLandGraph(new Float32Array(), 1_000, 500, roads);
    const army = base.state.armies.a;
    army.order = { path: [1, 2], destX: 200, destZ: 0, intent: 'attack', edgeProgress: 0 };
    base.state.countries[2] = { ...base.state.countries[1], id: 2, name: 'B', controller: 'neutral' };
    base.state.provinceOwners = { 10: 1, 11: 2, 12: 2 };
    base.state.relations = { '1:2': 'war' };
    const world = {
      ...base.world, roadNetwork: roads,
      provinces: [0, 1, 2].map((id) => ({
        id: 10 + id, center: [id * 100, 0] as const, terrainId: 0,
        population: 1, coastal: false, urban: false,
      })),
      provinceAt: (x: number) => x < 50 ? 10 : x < 150 ? 11 : 12,
    } as WorldData;
    const events = stepMovement({ state: base.state, world, graph }, 10);
    expect(events.some((event) => event.provinceId === 11)).toBe(true);
    expect(base.state.provinceOwners[11]).toBe(1);
  });
});
