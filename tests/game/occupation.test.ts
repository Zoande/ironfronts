import { describe, expect, it } from 'vitest';
import type { WorldData } from '../../src/game/world-data';
import type { GameState } from '../../src/game/game-state';
import { emptyStockpile, GAME_STATE_VERSION } from '../../src/game/game-state';
import { recomputeIncome } from '../../src/game/economy';
import { INITIAL_GAME_EPOCH_MS } from '../../src/game/time';

function world(originalOwnerOf: Record<number, number>): WorldData {
  return {
    width: 1000, height: 1000,
    provinces: [
      { id: 1, center: [0, 0], terrainId: 0, population: 100_000, coastal: false, urban: false },
      { id: 2, center: [10, 10], terrainId: 0, population: 100_000, coastal: false, urban: false },
    ],
    countries: [],
    provinceOwner: (id: number) => originalOwnerOf[id] ?? 0,
    provinceAt: () => -1,
    terrainClassAt: () => 0,
    connections: new Float32Array(0),
    resourceNodes: [],
  } as unknown as WorldData;
}

function state(owners: Record<number, number>): GameState {
  return {
    version: GAME_STATE_VERSION, seed: 1, scenarioId: 'x', mode: 'campaign',
    fogOfWar: false, economyEnabled: true,
    clock: { gameTimeHours: 0, startDate: '1 Sep 1939', initialEpochMs: INITIAL_GAME_EPOCH_MS, generation: 0 },
    simulationTick: 0,
    countries: {
      1: { id: 1, name: 'A', color: '#fff', controller: 'player', stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1 },
    },
    provinceOwners: owners,
    provinceBuildings: {}, productionQueues: {}, constructionQueues: {}, rallyPoints: {},
    armies: {}, resourceNodes: {}, relations: {}, battles: {}, battleFronts: {},
    nextArmyId: 1, nextBattleId: 1, nextFrontId: 1, nextOrderId: 1, nextEventId: 1,
  } as unknown as GameState;
}

describe('occupied territory produces less', () => {
  it('a province still held by its original owner earns full income', () => {
    const w = world({ 1: 1 });
    const s = state({ 1: 1 });
    recomputeIncome(s, w);
    const coreFunds = s.countries[1].income.funds;

    const wOccupied = world({ 1: 2 }); // originally country 2's, now held by 1
    const sOccupied = state({ 1: 1 });
    recomputeIncome(sOccupied, wOccupied);
    expect(sOccupied.countries[1].income.funds).toBeLessThan(coreFunds);
  });

  it('claiming previously-unowned ground is not treated as occupation', () => {
    const w = world({ 1: 0 }); // started unowned
    const claimed = state({ 1: 1 });
    recomputeIncome(claimed, w);

    const wCore = world({ 1: 1 });
    const core = state({ 1: 1 });
    recomputeIncome(core, wCore);
    expect(claimed.countries[1].income.funds).toBe(core.countries[1].income.funds);
  });
});
