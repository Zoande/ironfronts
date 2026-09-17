import { describe, expect, it } from 'vitest';
import { stepCombat, legalRetreatPaths } from '../../src/game/combat';
import { autoRetreat } from '../../src/game/combat/retreat';
import { GAME_STATE_VERSION, emptyStockpile, type BattleFrontState, type GameState } from '../../src/game/game-state';
import { buildLandGraph, edgePosition, type LandGraph } from '../../src/game/movement/graph';
import type { SimContext } from '../../src/game/sim-context';
import { parseGameState } from '../../src/game/state/state-schema';
import { makeGroup, stackMaxHp, type ArmyStack } from '../../src/game/units/army';
import { stepMovement } from '../../src/game/units/movement';
import type { CanonicalRoadNetwork, WorldData, WorldProvince } from '../../src/game/world-data';

const roads: CanonicalRoadNetwork = {
  version: 1,
  nodes: [
    { id: 0, sourceNodeId: 0, x: 0, z: 0 },
    { id: 1, sourceNodeId: 1, x: 100, z: 100 },
  ],
  edges: [{ id: 0, from: 0, to: 1, length: 200, pointOffset: 0, pointCount: 3, dotted: false }],
  centerlines: Float32Array.from([0, 0, 0, 100, 100, 100]),
};

function country(id: number) {
  return { id, name: String(id), color: '#fff', controller: 'player' as const,
    stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1 };
}

function province(id: number, x: number, z: number): WorldProvince {
  return { id, center: [x, z], terrainId: 0, population: 1, coastal: false, urban: false };
}

function context(
  armies: ArmyStack[], provinceAt: (x: number, z: number) => number = () => -1,
  provinces: WorldProvince[] = [], provinceOwners: Record<number, number> = {},
): SimContext {
  const graph = buildLandGraph(new Float32Array(), 1_000, 500, roads);
  const world: WorldData = {
    width: 1_000, height: 500, provinces,
    countries: [
      { id: 1, name: 'A', color: '#fff', capitalProvinceId: provinces[0]?.id ?? -1 },
      { id: 2, name: 'B', color: '#000', capitalProvinceId: -1 },
    ],
    provinceOwner: () => 0, provinceAt, terrainClassAt: () => 0,
    connections: new Float32Array(), roadNetwork: roads, resourceNodes: [],
  };
  const state = {
    version: GAME_STATE_VERSION, seed: 1, scenarioId: 'test', mode: 'campaign',
    fogOfWar: false, economyEnabled: false,
    clock: { gameTimeHours: 0, startDate: 'x' }, simulationTick: 1,
    countries: { 1: country(1), 2: country(2) }, provinceOwners,
    provinceBuildings: {}, productionQueues: {}, constructionQueues: {}, rallyPoints: {},
    armies: Object.fromEntries(armies.map((army) => [army.id, army])),
    battles: {}, battleFronts: {}, resourceNodes: {}, provinceEconomies: {},
    relations: { '1:2': 'war' }, nextArmyId: 10, nextBattleId: 1,
    nextFrontId: 1, nextOrderId: 1, nextEventId: 1,
  } as unknown as GameState;
  return { state, world, graph };
}

function onRoad(
  graph: LandGraph, id: string, ownerCountryId: number, canonicalDistance: number,
  direction: 'forward' | 'reverse' = 'forward', moving = true,
): ArmyStack {
  const point = edgePosition(graph, 0, canonicalDistance);
  const forward = direction === 'forward';
  return {
    id, ownerCountryId, name: id, ...point, graphNodeId: forward ? 0 : 1,
    edge: { edgeId: 0, from: forward ? 0 : 1, to: forward ? 1 : 0,
      distanceAlongEdge: forward ? canonicalDistance : 200 - canonicalDistance },
    units: [makeGroup('infantry', 3)], status: moving ? 'moving' : 'idle',
    order: moving ? {
      path: [forward ? 1 : 0], destX: forward ? 100 : 0, destZ: forward ? 100 : 0,
      intent: 'attack', edgeProgress: forward ? canonicalDistance : 200 - canonicalDistance,
    } : null,
    extractingNodeId: null,
  };
}

describe('canonical road combat and retreat', () => {
  it('detects contact along a curved traveled segment rather than its chord', () => {
    const initial = context([]);
    const mover: ArmyStack = {
      id: 'mover', ownerCountryId: 1, name: 'mover', x: 0, z: 0, graphNodeId: 0,
      units: [makeGroup('infantry', 3)], status: 'moving', extractingNodeId: null,
      order: { path: [1], destX: 100, destZ: 100, intent: 'attack', edgeProgress: 0 },
    };
    const blocker = onRoad(initial.graph, 'blocker', 2, 80, 'forward', false);
    const c = context([mover, blocker]);
    stepMovement(c, 10);
    expect(mover.x).toBeCloseTo(0, 6);
    expect(mover.z).toBeCloseTo(54, 5);
    stepCombat(c, 0);
    expect(mover.status).toBe('engaged');
  });

  it('gives opposite-direction armies distinct approaches at a mid-edge meeting', () => {
    const initial = context([]);
    const a = onRoad(initial.graph, 'a', 1, 70, 'forward');
    const b = onRoad(initial.graph, 'b', 2, 90, 'reverse');
    const c = context([a, b]);
    stepCombat(c, 0);
    const front = Object.values(c.state.battleFronts)[0];
    expect(front).toMatchObject({ edgeId: 0, distanceAlongEdge: 80, x: 0, z: 80 });
    expect(new Set([front.sideA.directionNodeId, front.sideB.directionNodeId])).toEqual(new Set([0, 1]));
    stepCombat(c, 0);
    expect(Object.keys(c.state.battleFronts)).toHaveLength(1);
    expect(parseGameState(JSON.parse(JSON.stringify(c.state))).battleFronts[front.id]).toMatchObject({
      edgeId: 0, distanceAlongEdge: 80,
    });
  });

  it('retreats forward when an attack comes from behind on the occupied edge', () => {
    const initial = context([]);
    const column = onRoad(initial.graph, 'column', 1, 80, 'forward');
    const pursuer = onRoad(initial.graph, 'pursuer', 2, 60, 'forward');
    const safe = province(10, 100, 100);
    const c = context([column, pursuer], () => 10, [safe], { 10: 1 });
    stepCombat(c, 0);
    const exits = legalRetreatPaths(c, column.id);
    expect(exits).toHaveLength(1);
    expect(exits[0].firstNodeId).toBe(1);
  });

  it('resolves the front province at contact across a province boundary', () => {
    const initial = context([]);
    const a = onRoad(initial.graph, 'a', 1, 60, 'forward');
    const b = onRoad(initial.graph, 'b', 2, 80, 'reverse');
    const provinces = [province(10, 0, 0), province(20, 0, 80)];
    const c = context([a, b], (_x, z) => z < 50 ? 10 : 20, provinces, { 10: 1, 20: 2 });
    stepCombat(c, 0);
    const front = Object.values(c.state.battleFronts)[0];
    expect(front.anchorNodeId).toBe(0);
    expect(front.z).toBe(70);
    expect(front.provinceId).toBe(20);
  });

  it('marks both directions closed when a mid-edge army is encircled', () => {
    const initial = context([]);
    const center = onRoad(initial.graph, 'center', 1, 80, 'forward');
    const rear = onRoad(initial.graph, 'rear', 2, 60, 'forward');
    const ahead = onRoad(initial.graph, 'ahead', 2, 100, 'reverse');
    const safe = province(10, 100, 100);
    const c = context([center, rear, ahead], () => 10, [safe], { 10: 1 });
    stepCombat(c, 0);
    expect(center.battleFrontIds).toHaveLength(2);
    expect(legalRetreatPaths(c, center.id)).toEqual([]);
  });

  it('retreats routable stacks even when another stack on the side is trapped', () => {
    const initial = context([]);
    const routable = onRoad(initial.graph, 'routable', 1, 80, 'forward');
    const trapped = onRoad(initial.graph, 'trapped', 1, 80, 'forward');
    const enemy = onRoad(initial.graph, 'enemy', 2, 60, 'forward');
    const safe = province(10, 100, 100);
    const c = context([routable, trapped, enemy], () => 10, [safe], { 10: 1 });
    for (const army of [routable, trapped, enemy]) {
      army.status = 'engaged';
      army.organization = army.ownerCountryId === 1 ? 0 : 100;
      army.order = null;
      army.battleFrontIds = ['front-1'];
    }
    const front: BattleFrontState = {
      id: 'front-1', battleId: 'battle-1', anchorNodeId: 0, kind: 'road', provinceId: null,
      x: 0, z: 70, edgeId: 0, distanceAlongEdge: 70,
      sideA: { countryId: 1, directionNodeId: 0, role: 'attack',
        armyIds: [routable.id, trapped.id],
        entryMaxHpByArmy: { routable: stackMaxHp(routable), trapped: stackMaxHp(trapped) } },
      sideB: { countryId: 2, directionNodeId: 0, role: 'attack', armyIds: [enemy.id],
        entryMaxHpByArmy: { enemy: stackMaxHp(enemy) } },
    };
    c.state.battles['battle-1'] = { id: 'battle-1', frontIds: [front.id] };
    c.state.battleFronts[front.id] = front;
    // Give only one stack an additional enemy front blocking its forward exit.
    const ahead = onRoad(c.graph, 'ahead', 2, 100, 'reverse');
    ahead.status = 'engaged'; ahead.order = null; ahead.battleFrontIds = ['front-2'];
    c.state.armies[ahead.id] = ahead;
    trapped.battleFrontIds!.push('front-2');
    const trapFront: BattleFrontState = {
      ...front, id: 'front-2', sideA: { ...front.sideA, armyIds: [trapped.id],
        entryMaxHpByArmy: { trapped: stackMaxHp(trapped) } },
      sideB: { ...front.sideB, directionNodeId: 1, armyIds: [ahead.id],
        entryMaxHpByArmy: { ahead: stackMaxHp(ahead) } },
    };
    c.state.battles['battle-1'].frontIds.push(trapFront.id);
    c.state.battleFronts[trapFront.id] = trapFront;

    expect(autoRetreat(c, front, front.sideA)).toBe(true);
    expect(routable.status).toBe('retreating');
    expect(trapped.status).toBe('engaged');
  });
});
