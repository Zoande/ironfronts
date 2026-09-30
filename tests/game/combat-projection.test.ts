import { describe, expect, it } from 'vitest';
import { stepCombat } from '../../src/game/combat';
import { GAME_STATE_VERSION, emptyStockpile, type GameState } from '../../src/game/game-state';
import { buildLandGraph } from '../../src/game/movement/graph';
import { projectArmyView } from '../../src/game/player-view';
import type { SimContext } from '../../src/game/sim-context';
import { makeGroup, stackHp, type ArmyStack } from '../../src/game/units/army';
import type { WorldData } from '../../src/game/world-data';

function army(id: string, ownerCountryId: number, x: number, node: number): ArmyStack {
  return {
    id, ownerCountryId, name: id, x, z: 100, graphNodeId: node,
    units: [makeGroup('infantry', 4)], status: 'idle', order: null, extractingNodeId: null,
  };
}

function context(): SimContext {
  const attackers = army('attackers', 1, 100, 0);
  attackers.status = 'moving';
  attackers.stance = 'attack';
  attackers.order = {
    path: [1], destX: 200, destZ: 100, intent: 'attack',
    target: { kind: 'position', x: 200, z: 100 }, edgeProgress: 0,
  };
  const defenders = army('defenders', 2, 100, 0);
  defenders.stance = 'defend';
  const graph = buildLandGraph(new Float32Array([100, 100, 200, 100, 1, 0, 0, 0]), 1_000, 500);
  const world: WorldData = {
    width: 1_000, height: 500, provinces: [],
    countries: [
      { id: 1, name: 'A', color: '#fff', capitalProvinceId: -1 },
      { id: 2, name: 'B', color: '#000', capitalProvinceId: -1 },
    ],
    provinceOwner: () => 0, provinceAt: () => -1, terrainClassAt: () => 0,
    connections: new Float32Array(0), resourceNodes: [],
  };
  const state: GameState = {
    version: GAME_STATE_VERSION, seed: 1, scenarioId: 'OP-1939-01', mode: 'campaign',
    fogOfWar: false, economyEnabled: false,
    clock: { gameTimeHours: 0, startDate: 'x' }, simulationTick: 1,
    countries: {
      1: { id: 1, name: 'A', color: '#fff', controller: 'player', stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1 },
      2: { id: 2, name: 'B', color: '#000', controller: 'ai', stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1 },
    },
    provinceOwners: {}, provinceBuildings: {}, productionQueues: {}, constructionQueues: {}, rallyPoints: {},
    armies: { attackers, defenders }, battles: {}, battleFronts: {}, resourceNodes: {}, relations: { '1:2': 'war' },
    nextArmyId: 10, nextBattleId: 1, nextOrderId: 1, nextEventId: 1,
  };
  return { state, graph, world };
}

describe('authoritative combat projection', () => {
  it('projects the exact current damage rates used by the next combat step', () => {
    const ctx = context();
    stepCombat(ctx, 0);
    const projected = projectArmyView(ctx.state, ctx.world, 1, 'attackers', undefined, 2)!;
    const front = projected.battleFronts![0];
    const friendlyBefore = stackHp(ctx.state.armies.attackers);
    const enemyBefore = stackHp(ctx.state.armies.defenders);

    stepCombat(ctx, 0.01);

    expect(enemyBefore - stackHp(ctx.state.armies.defenders)).toBeCloseTo(front.outgoingDamagePerGameHour * 0.01, 8);
    expect(friendlyBefore - stackHp(ctx.state.armies.attackers)).toBeCloseTo(front.incomingDamagePerGameHour * 0.01, 8);
    expect(front.estimatedGameHours).toBeCloseTo(Math.min(
      front.enemyHp / front.outgoingDamagePerGameHour,
      front.friendlyHp / front.incomingDamagePerGameHour,
    ), 8);
    expect(front.estimatedRealSeconds).toBeCloseTo(front.estimatedGameHours! / 2, 8);
  });

  it('projects current casualties and the active combat modifiers', () => {
    const ctx = context();
    stepCombat(ctx, 0);
    stepCombat(ctx, 0.01);
    const front = projectArmyView(ctx.state, ctx.world, 1, 'attackers')!.battleFronts![0];

    expect(front.friendlyCasualties).toBeGreaterThan(0);
    expect(front.enemyCasualties).toBeGreaterThan(0);
    expect(front.friendlyModifiers).toMatchObject({
      frontageUsed: 4,
      frontageLimit: 10,
      coordination: 0.5,
      stanceOutput: 1.25,
    });
    expect(front.enemyModifiers).toMatchObject({
      frontageUsed: 4,
      frontageLimit: 10,
      coordination: 0.5,
      protection: 0.8,
    });
  });
});
