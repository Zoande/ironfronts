import { describe, expect, it } from 'vitest';
import { issueAttack } from '../../src/game/commands/attack';
import { GAME_STATE_VERSION, emptyStockpile, type GameState } from '../../src/game/game-state';
import type { WorldData } from '../../src/game/world-data';
import { makeGroup, type ArmyStack } from '../../src/game/units/army';

function army(id: string, owner: number, x: number, z: number): ArmyStack {
  return {
    id, ownerCountryId: owner, name: id, x, z, graphNodeId: 0,
    units: [makeGroup('infantry', 3)], status: 'idle', order: null, extractingNodeId: null,
  };
}

function state(armies: ArmyStack[]): GameState {
  return {
    version: GAME_STATE_VERSION, seed: 1, scenarioId: 'OP-1939-01', mode: 'campaign',
    fogOfWar: true, economyEnabled: true,
    clock: { gameTimeHours: 0, startDate: 'x' }, simulationTick: 0,
    countries: {
      1: { id: 1, name: 'A', color: '#fff', controller: 'player', stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1 },
      2: { id: 2, name: 'B', color: '#000', controller: 'neutral', stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1 },
    },
    provinceOwners: {}, provinceBuildings: {}, productionQueues: {}, constructionQueues: {}, rallyPoints: {},
    armies: Object.fromEntries(armies.map((a) => [a.id, a])),
    resourceNodes: {}, relations: {}, battles: {}, battleFronts: {},
    nextArmyId: 99, nextBattleId: 1, nextOrderId: 1, nextEventId: 1,
  };
}

const world: WorldData = {
  width: 10_000, height: 5_000, provinces: [], countries: [],
  provinceOwner: () => 0, provinceAt: () => -1, terrainClassAt: () => -1,
  connections: new Float32Array(0), resourceNodes: [],
};

const ctx = (armies: ArmyStack[]): { state: GameState; world: WorldData } => ({ state: state(armies), world });

// infantry visionInner 90 (=> 'visible'), visionOuter 180 (=> 'contact').
describe('direct army attack requires a fully identified target', () => {
  it('rejects a strike on a contact-range detection without leaking its position', () => {
    const c = ctx([army('p', 1, 0, 0), army('e', 2, 130, 0)]);
    const result = issueAttack(c as never, { type: 'attackArmy', countryId: 1, armyId: 'p', target: { kind: 'army', armyId: 'e' } });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/only a contact/i);
  });

  it('rejects a strike on an undetected target', () => {
    const c = ctx([army('p', 1, 0, 0), army('e', 2, 5_000, 0)]);
    const result = issueAttack(c as never, { type: 'attackArmy', countryId: 1, armyId: 'p', target: { kind: 'army', armyId: 'e' } });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no longer detected/i);
  });

  it('passes the identification gate for a target in direct view', () => {
    const c = ctx([army('p', 1, 0, 0), army('e', 2, 60, 0)]);
    const result = issueAttack(c as never, { type: 'attackArmy', countryId: 1, armyId: 'p', target: { kind: 'army', armyId: 'e' } });
    // It may still fail later for lack of a movement graph, but not on identification.
    expect(result.reason ?? '').not.toMatch(/contact|detected/i);
  });
});
