import { describe, expect, it } from 'vitest';
import type { LandGraph } from '../../src/game/movement/graph';
import type { SimContext } from '../../src/game/sim-context';
import type { WorldData } from '../../src/game/world-data';
import type { GameState } from '../../src/game/game-state';
import { stepCapture, stepCombat } from '../../src/game/combat';
import { DEVASTATED_DEFENDER_STRENGTH_MULTIPLIER } from '../../src/game/combat/constants';
import { stepWarheads } from '../../src/game/strike';

/**
 * A strike stamps `provinceDevastation[id]`. It weakens a city garrison in
 * combat but never allows an attacker to capture through a defender.
 */
function graph(): LandGraph {
  return {
    nodeX: new Float64Array([100, 300]),
    nodeZ: new Float64Array([100, 100]),
    adjacency: [[1], [0]],
    edgeCost: [[200], [200]],
    seaAdjacency: [[], []],
    seaEdgeCost: [[], []],
    component: new Int32Array([0, 0]),
    componentSize: [2],
    nodeCount: 2,
    width: 10_000,
    height: 5_000,
  } as unknown as LandGraph;
}

function world(): WorldData {
  return {
    width: 10_000, height: 5_000,
    provinces: [{
      id: 5, center: [100, 100], terrainId: 0, population: 0, coastal: false, urban: true,
    }],
    countries: [
      { id: 1, name: 'A', color: '#fff', capitalProvinceId: 5 },
      { id: 2, name: 'B', color: '#000', capitalProvinceId: 5 },
    ],
    provinceOwner: () => 2,
    provinceAt: () => 5,
    terrainClassAt: () => 0,
    connections: new Float32Array(0),
    resourceNodes: [],
  } as unknown as WorldData;
}

function ctx(devastatedUntilHours: number | undefined): SimContext {
  const state = {
    clock: { gameTimeHours: 10, startDate: 'x' },
    countries: {
      1: { id: 1, name: 'A', color: '#fff' },
      2: { id: 2, name: 'B', color: '#000' },
    },
    provinceOwners: { 5: 2 },
    provinceBuildings: {}, productionQueues: {}, constructionQueues: {}, rallyPoints: {},
    resourceNodes: {},
    relations: { '1:2': 'war' },
    provinceDevastation: devastatedUntilHours === undefined ? {} : { 5: devastatedUntilHours },
    armies: {
      atk: {
        id: 'atk', ownerCountryId: 1, name: 'Spain', x: 100, z: 100, graphNodeId: 0,
        units: [{ typeId: 'infantry', count: 3, hp: 240, experience: 0 }],
        status: 'idle', order: null, extractingNodeId: null,
      },
      def: {
        id: 'def', ownerCountryId: 2, name: 'Garrison', x: 118, z: 100, graphNodeId: 1,
        units: [{ typeId: 'infantry', count: 3, hp: 240, experience: 0 }],
        status: 'idle', order: null, extractingNodeId: null,
      },
    },
  } as unknown as GameState;
  return { state, graph: graph(), world: world() };
}

describe('strike devastation weakens defenders without bypassing capture', () => {
  it('a lone adjacent defender still blocks capture of an undamaged province', () => {
    const c = ctx(undefined);
    const events = stepCapture(c);
    expect(events).toHaveLength(0);
    expect(c.state.provinceOwners[5]).toBe(2);
  });

  it('a devastated province still engages its defender before it can flip', () => {
    const c = ctx(200); // devastation lifts at hour 200; clock is at 10
    expect(stepCapture(c)).toHaveLength(0);
    expect(c.state.provinceOwners[5]).toBe(2);

    const combat = stepCombat(c, 0);
    expect(combat.some((event) => event.kind === 'engaged')).toBe(true);
    expect(c.state.armies.atk.status).toBe('engaged');
    expect(c.state.armies.def.status).toBe('engaged');
    expect(stepCapture(c)).toHaveLength(0);
    expect(c.state.provinceOwners[5]).toBe(2);
  });

  it('reduces a devastated garrison to 40% of its normal combat output', () => {
    const normal = ctx(undefined);
    const devastated = ctx(200);

    stepCombat(normal, 0.05);
    stepCombat(devastated, 0.05);

    const normalAttackerLoss = 240 - normal.state.armies.atk.units[0].hp;
    const devastatedAttackerLoss = 240 - devastated.state.armies.atk.units[0].hp;
    const normalDefenderLoss = 240 - normal.state.armies.def.units[0].hp;
    const devastatedDefenderLoss = 240 - devastated.state.armies.def.units[0].hp;

    expect(devastatedAttackerLoss)
      .toBeCloseTo(normalAttackerLoss * DEVASTATED_DEFENDER_STRENGTH_MULTIPLIER, 8);
    expect(devastatedDefenderLoss).toBeCloseTo(normalDefenderLoss, 8);
    expect(devastatedDefenderLoss).toBeGreaterThan(devastatedAttackerLoss * 3);
  });

  it.each([
    ['without devastation', undefined],
    ['during devastation', 200],
  ])('an undefended province flips immediately %s', (_label, devastatedUntil) => {
    const c = ctx(devastatedUntil);
    delete c.state.armies.def;

    const events = stepCapture(c);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ provinceId: 5, fromCountryId: 2, toCountryId: 1 });
    expect(c.state.provinceOwners[5]).toBe(1);
  });

  it('stepWarheads prunes devastation entries whose window has elapsed', () => {
    const c = ctx(5);
    stepWarheads(c, 0.05);
    expect(c.state.provinceDevastation).toEqual({});
  });
});
