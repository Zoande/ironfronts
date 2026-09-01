/**
 * An attack order must never be accepted against the attacker's own force or
 * own territory, and when it IS accepted against a hostile army the installed
 * route must end on that army's node — the target the player picked and the
 * route the player sees have to agree (no separate "attack line").
 */

import { describe, expect, it } from 'vitest';
import { GAME_STATE_VERSION, emptyStockpile, type GameState } from '../../src/game/game-state';
import { buildLandGraph, nearestNode, type LandGraph } from '../../src/game/movement/graph';
import type { SimContext } from '../../src/game/sim-context';
import type { WorldData } from '../../src/game/world-data';
import { issueAttack } from '../../src/game/commands/attack';
import type { ArmyStack } from '../../src/game/units/army';

// A straight 3-node chain: (100,100) - (300,100) - (500,100).
function graph(): LandGraph {
  return buildLandGraph(new Float32Array([
    100, 100, 300, 100, 1, 0, 0, 0,
    300, 100, 500, 100, 1, 0, 0, 0,
  ]), 10_000, 5_000);
}

function army(id: string, owner: number, x: number, z: number, node: number): ArmyStack {
  return {
    id, ownerCountryId: owner, name: id, x, z, graphNodeId: node,
    units: [{ typeId: 'infantry', count: 3, hp: 300, experience: 0 }],
    status: 'idle', order: null, extractingNodeId: null,
  } satisfies ArmyStack;
}

function ctx(armies: ArmyStack[], provinceOwners: Record<number, number> = {}): SimContext {
  const g = graph();
  const world: WorldData = {
    width: 10_000, height: 5_000,
    provinces: [
      { id: 10, center: [500, 100], terrainId: 4, population: 400, coastal: false, urban: true },
      { id: 20, center: [500, 100], terrainId: 4, population: 400, coastal: false, urban: true },
    ],
    countries: [
      { id: 1, name: 'A', color: '#fff', capitalProvinceId: 10 },
      { id: 2, name: 'B', color: '#000', capitalProvinceId: 20 },
    ],
    provinceOwner: () => 0, provinceAt: () => 10, terrainClassAt: () => 4,
    connections: new Float32Array(0), resourceNodes: [],
  };
  const state: GameState = {
    version: GAME_STATE_VERSION, seed: 1, scenarioId: 'OP-1939-01', mode: 'campaign',
    fogOfWar: false, economyEnabled: false,
    clock: { gameTimeHours: 0, startDate: 'x' }, simulationTick: 0,
    countries: {
      1: { id: 1, name: 'A', color: '#fff', controller: 'player', stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1 },
      2: { id: 2, name: 'B', color: '#000', controller: 'ai', stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1 },
    },
    provinceOwners, provinceBuildings: {}, productionQueues: {}, constructionQueues: {}, rallyPoints: {},
    armies: Object.fromEntries(armies.map((a) => [a.id, a])),
    resourceNodes: {}, relations: {}, battles: {}, battleFronts: {},
    nextArmyId: 99, nextBattleId: 1, nextOrderId: 1, nextEventId: 1,
  };
  return { state, graph: g, world };
}

describe('attack target validation', () => {
  it('rejects a strike on one of your own armies', () => {
    const c = ctx([army('p', 1, 100, 100, 0), army('mine', 1, 500, 100, 2)]);
    const result = issueAttack(c, { type: 'attackArmy', countryId: 1, armyId: 'p', target: { kind: 'army', armyId: 'mine' } });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/own force/i);
    expect(c.state.armies.p.order).toBeNull();
  });

  it('rejects an attack on a province you already hold', () => {
    const c = ctx([army('p', 1, 100, 100, 0)], { 10: 1 });
    const result = issueAttack(c, { type: 'attackArmy', countryId: 1, armyId: 'p', target: { kind: 'province', provinceId: 10 } });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/already hold/i);
    expect(c.state.armies.p.order).toBeNull();
  });

  it('routes an accepted strike to the hostile army’s own node', () => {
    const enemyNode = nearestNode(graph(), 500, 100);
    // Enemy sitting a little off its node — the route must still end on the node,
    // not at the raw enemy x/z.
    const c = ctx([army('p', 1, 100, 100, 0), army('e', 2, 512, 108, enemyNode)], { 20: 2 });
    const result = issueAttack(c, {
      type: 'attackArmy', countryId: 1, armyId: 'p',
      target: { kind: 'army', armyId: 'e' }, confirmedWarCountryIds: [2],
    });
    expect(result.ok).toBe(true);
    const order = c.state.armies.p.order;
    expect(order?.intent).toBe('attack');
    expect(order?.target).toMatchObject({ kind: 'army', armyId: 'e' });
    const lastNode = order!.path[order!.path.length - 1];
    expect(lastNode).toBe(enemyNode);
  });

  it('does not reject an attack on a hostile-held province on ownership grounds', () => {
    const c = ctx([army('p', 1, 100, 100, 0)], { 20: 2 });
    const result = issueAttack(c, { type: 'attackArmy', countryId: 1, armyId: 'p', target: { kind: 'province', provinceId: 20 } });
    expect(result.reason ?? '').not.toMatch(/already hold|own/i);
  });
});
