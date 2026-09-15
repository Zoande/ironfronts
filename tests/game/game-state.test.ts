import { describe, expect, it } from 'vitest';
import {
  GAME_STATE_VERSION, cloneGameState, deserializeGameState, emptyStockpile,
  relationOf, serializeGameState, setRelation, type GameState,
} from '../../src/game/game-state';

function minimalState(): GameState {
  return {
    version: GAME_STATE_VERSION,
    seed: 1,
    scenarioId: 'OP-1939-01',
    mode: 'campaign',
    fogOfWar: true,
    economyEnabled: true,
    clock: { gameTimeHours: 12.5, startDate: '1 Sep 1939', initialEpochMs: Date.UTC(1939,8,1,10), generation: 0 }, simulationTick: 0,
    countries: {
      24: {
        id: 24, name: 'Spain', color: '#8EB0BB', controller: 'player',
        stockpile: { ...emptyStockpile(), funds: 100 },
        income: emptyStockpile(), industryCapacity: 10, warheads: 0, phase: 2,
      },
    },
    provinceOwners: { 294: 24, 295: 0 },
    provinceBuildings: { 294: { barracks: 1, tankPlant: 1, ordnance: 0, missileSite: 0 } },
    productionQueues: {}, constructionQueues: {}, rallyPoints: {},
    armies: {
      'army-1': {
        id: 'army-1', ownerCountryId: 24, name: '1st Army', x: 100, z: 200,
        graphNodeId: 5, status: 'idle', order: null, extractingNodeId: null,
        navalCrossing: null, organization: 100, entrenchment: 0, stance: 'attack-defend', inSupply: true,
        units: [{ typeId: 'infantry', count: 4, hp: 400, experience: 0 }],
      },
    },
    resourceNodes: {
      7: {
        id: 7, kind: 'metal', x: 120, z: 210, remaining: 145, initialAmount: 145,
        controllerCountryId: 24, provinceId: 294, accessNodeId: 5,
        extractorArmyId: null, status: 'idle', provenance: 'generatedNatural',
      },
    },
    relations: {}, provinceDevastation: {}, provinceEconomies: {},
    diplomacyMessages: {}, diplomacyProposals: {}, resourceTradeProposals: {},
    nextDiplomacyId: 1,
    battles: {}, battleFronts: {},
    nextArmyId: 2, nextBattleId: 1, nextFrontId: 1, nextOrderId: 1, nextEventId: 1,
  };
}

describe('game-state serialization', () => {
  it('normalizes once, then round-trips through JSON unchanged', () => {
    const state = minimalState();
    const restored = deserializeGameState(serializeGameState(state));
    expect(deserializeGameState(serializeGameState(restored))).toEqual(restored);
    expect(restored.diplomacyMessages).toEqual({});
    expect(restored.diplomacyProposals).toEqual({});
    expect(restored.nextDiplomacyId).toBe(1);
  });

  it('cloneGameState is a deep, independent copy', () => {
    const state = minimalState();
    const copy = cloneGameState(state);
    copy.countries[24].stockpile.funds = 999;
    copy.armies['army-1'].units[0].count = 99;
    expect(state.countries[24].stockpile.funds).toBe(100);
    expect(state.armies['army-1'].units[0].count).toBe(4);
  });

  it('rejects an unknown version', () => {
    const bad = JSON.stringify({ ...minimalState(), version: 999 });
    expect(() => deserializeGameState(bad)).toThrow(/version/);
  });

  it('discards the retired campaign outcome field from old saves', () => {
    const legacy = { ...minimalState(), outcome: { result: 'victory', reason: 'legacy', atGameHours: 4 } };
    const restored = deserializeGameState(JSON.stringify(legacy));
    expect(restored).not.toHaveProperty('outcome');
  });

  it('has no functions, class instances, or nested prototypes', () => {
    const state = minimalState();
    const seen = new Set<unknown>();
    const walk = (value: unknown): void => {
      if (value === null || typeof value !== 'object') {
        expect(typeof value).not.toBe('function');
        return;
      }
      if (seen.has(value)) return;
      seen.add(value);
      const proto = Object.getPrototypeOf(value);
      expect(proto === Object.prototype || proto === Array.prototype).toBe(true);
      for (const child of Object.values(value as Record<string, unknown>)) walk(child);
    };
    walk(state);
  });

  it('relation helpers are symmetric and default to peace', () => {
    const state = minimalState();
    expect(relationOf(state, 24, 41)).toBe('peace');
    setRelation(state, 41, 24, 'war');
    expect(relationOf(state, 24, 41)).toBe('war');
    expect(state.relations['24:41']).toBe('war');
    setRelation(state, 24, 41, 'allied');
    expect(relationOf(state, 41, 24)).toBe('allied');
    setRelation(state, 24, 41, 'peace');
    expect(relationOf(state, 24, 41)).toBe('peace');
    expect(Object.keys(state.relations)).toHaveLength(0);
  });
});
