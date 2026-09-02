import { describe, expect, it } from 'vitest';
import { stepCombat } from '../../src/game/combat';
import { LEGACY_VOLLEY_GAME_HOURS } from '../../src/game/combat/constants';
import { GAME_STATE_VERSION, emptyStockpile, type GameState } from '../../src/game/game-state';
import { buildLandGraph } from '../../src/game/movement/graph';
import type { SimContext } from '../../src/game/sim-context';
import type { ArmyStack } from '../../src/game/units/army';
import { UNIT_TYPES } from '../../src/game/units/unit-catalog';
import type { WorldData } from '../../src/game/world-data';

function army(
  id: string, ownerCountryId: number, typeId: string, count: number, x = 100, node = 0,
): ArmyStack {
  const type = UNIT_TYPES.find((unit) => unit.id === typeId)!;
  return {
    id, ownerCountryId, name: id, x, z: 100, graphNodeId: node,
    units: [{ typeId, count, hp: count * type.maxHp, experience: 0 }],
    status: 'idle', order: null, extractingNodeId: null,
  };
}

function context(armies: Record<string, ArmyStack>, relations: Record<string, 'war'>): SimContext {
  const graph = buildLandGraph(
    new Float32Array([100, 100, 200, 100, 1, 0, 0, 0]), 1_000, 500,
  );
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
    clock: { gameTimeHours: 0, startDate: 'x' }, simulationTick: 0,
    countries: {
      1: { id: 1, name: 'A', color: '#fff', controller: 'player', stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1 },
      2: { id: 2, name: 'B', color: '#000', controller: 'ai', stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1 },
    },
    provinceOwners: {}, provinceBuildings: {}, productionQueues: {},
    constructionQueues: {}, rallyPoints: {}, armies, battles: {}, battleFronts: {},
    resourceNodes: {}, relations, nextArmyId: 10, nextBattleId: 1,
    nextOrderId: 1, nextEventId: 1,
  };
  return { state, graph, world };
}

describe('v2 continuous combat', () => {
  it('contains translated armor-specific damage-per-hour profiles', () => {
    const rate = (soft: number, light: number, heavy: number) => ({
      soft: soft / LEGACY_VOLLEY_GAME_HOURS,
      light: light / LEGACY_VOLLEY_GAME_HOURS,
      heavy: heavy / LEGACY_VOLLEY_GAME_HOURS,
    });
    expect(UNIT_TYPES.map((unit) => [unit.id, unit.attack, unit.defense])).toEqual([
      ['infantry', rate(8, 4.4, 2.4), rate(6, 3.3, 1.8)],
      ['engineer', rate(1.8, 0.9, 0.45), rate(2.4, 1.2, 0.6)],
      ['armored-car', rate(6.6, 4.2, 2.1), rate(7.7, 4.9, 2.45)],
      ['light-tank', rate(16.8, 14.7, 9.8), rate(14.4, 12.6, 8.4)],
      ['medium-tank', rate(26.4, 23.1, 15.4), rate(24, 21, 14)],
      ['artillery', rate(29.9, 23.4, 32.5), rate(3.45, 2.7, 3.75)],
    ]);
  });

  it('applies frontage-capped simultaneous damage on every elapsed-hour step', () => {
    const attackers = army('attackers', 1, 'infantry', 12);
    attackers.status = 'moving';
    attackers.order = {
      path: [1], destX: 200, destZ: 100, intent: 'attack',
      target: { kind: 'position', x: 200, z: 100 }, edgeProgress: 0,
    };
    const defenders = army('defenders', 2, 'infantry', 20);
    const ctx = context({ attackers, defenders }, { '1:2': 'war' });

    stepCombat(ctx, 0.05);
    expect(defenders.units[0].hp).toBeCloseTo(2_000 - (80 / 900 * 0.05), 8);
    expect(attackers.units[0].hp).toBeCloseTo(1_200 - (60 / 900 * 0.05), 8);
    expect(defenders.units[0].count).toBe(20); // overflow absorbed pooled damage
    const afterFirstTick = defenders.units[0].hp;
    stepCombat(ctx, 0.05);
    expect(defenders.units[0].hp).toBeLessThan(afterFirstTick);

    const legacyEquivalent = context({
      attackers: army('attackers', 1, 'infantry', 12),
      defenders: army('defenders', 2, 'infantry', 20),
    }, { '1:2': 'war' });
    legacyEquivalent.state.armies.attackers.status = 'moving';
    stepCombat(legacyEquivalent, LEGACY_VOLLEY_GAME_HOURS);
    expect(legacyEquivalent.state.armies.defenders.units[0].hp).toBeCloseTo(1_920, 5);
    expect(legacyEquivalent.state.armies.attackers.units[0].hp).toBeCloseTo(1_140, 5);
  });

  it('lets peaceful overlapping armies pass without battle or war', () => {
    const ctx = context({
      a: army('a', 1, 'infantry', 2),
      b: army('b', 2, 'infantry', 2),
    }, {});
    stepCombat(ctx, 0.05);
    expect(ctx.state.battles).toEqual({});
    expect(ctx.state.relations).toEqual({});
    expect(ctx.state.armies.a.status).toBe('idle');
    expect(ctx.state.armies.b.status).toBe('idle');
  });

  it('applies continuous ranged artillery damage without a cooldown', () => {
    const battery = army('battery', 1, 'artillery', 11, 100, 0);
    const target = army('target', 2, 'medium-tank', 1, 200, 1);
    const ctx = context({ battery, target }, { '1:2': 'war' });
    const events = stepCombat(ctx, 0.05);
    expect(ctx.state.armies.target.units[0].hp).toBeLessThan(190);
    expect(events.some((event) => event.kind === 'bombardment')).toBe(true);
    stepCombat(ctx, LEGACY_VOLLEY_GAME_HOURS);
    expect(ctx.state.armies.target).toBeUndefined();
  });
});
