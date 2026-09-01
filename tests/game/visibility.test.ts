import { describe, expect, it } from 'vitest';
import { computeArmyVisibility, foreignDetailVisible } from '../../src/game/visibility';
import { GAME_STATE_VERSION, emptyStockpile, type GameState } from '../../src/game/game-state';
import type { WorldData } from '../../src/game/world-data';
import { makeGroup, type ArmyStack } from '../../src/game/units/army';

function army(id: string, owner: number, x: number, z: number, typeId = 'infantry'): ArmyStack {
  return {
    id, ownerCountryId: owner, name: id, x, z, graphNodeId: 0,
    units: [makeGroup(typeId, 3)], status: 'idle', order: null, extractingNodeId: null,
  };
}

function state(fog: boolean, armies: ArmyStack[]): GameState {
  return {
    version: GAME_STATE_VERSION, seed: 1, scenarioId: 'OP-1939-01', mode: 'campaign',
    fogOfWar: fog, economyEnabled: true,
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

// Infantry: visionOuter 180, visionInner 90 (unit-catalog).
describe('fog of war visibility', () => {
  it('reveals everything when fog is disabled', () => {
    const s = state(false, [army('p', 1, 0, 0), army('e', 2, 9_000, 4_000)]);
    const v = computeArmyVisibility(s, world, 1);
    expect(v.get('p')).toBe('visible');
    expect(v.get('e')).toBe('visible');
  });

  it('own armies are always visible under fog', () => {
    const s = state(true, [army('p', 1, 0, 0)]);
    expect(computeArmyVisibility(s, world, 1).get('p')).toBe('visible');
  });

  it('foreign army: inner->visible, outer->contact, beyond->hidden', () => {
    const near = state(true, [army('p', 1, 0, 0), army('e', 2, 70, 0)]);   // 70 < inner 90
    expect(computeArmyVisibility(near, world, 1).get('e')).toBe('visible');

    const mid = state(true, [army('p', 1, 0, 0), army('e', 2, 140, 0)]);   // 90 < 140 < 180
    expect(computeArmyVisibility(mid, world, 1).get('e')).toBe('contact');

    const far = state(true, [army('p', 1, 0, 0), army('e', 2, 400, 0)]);   // > outer
    expect(computeArmyVisibility(far, world, 1).get('e')).toBe('hidden');
  });

  it('wraps X for the vision check', () => {
    const s = state(true, [army('p', 1, 20, 0), army('e', 2, 9_980, 0)]); // 40 apart across seam
    expect(computeArmyVisibility(s, world, 1).get('e')).toBe('visible');
  });

  it('does not leak an enemy stack sitting in its own land with no friendly eyes nearby', () => {
    // Greek province centre used to cast a 130u contact ring that crossed the
    // border; an enemy stack deep in country B must now be hidden.
    const s = state(true, [army('p', 1, 0, 0), army('e', 2, 3_000, 0)]);
    s.provinceOwners = { 7: 1 };
    const bordered: WorldData = { ...world, provinceAt: (x) => (x > 2_500 ? 9 : 7) };
    expect(computeArmyVisibility(s, bordered, 1).get('e')).toBe('hidden');
  });

  it('reveals a foreign stack that walks onto ground the viewer owns', () => {
    const s = state(true, [army('p', 1, 0, 0), army('e', 2, 3_000, 0)]);
    s.provinceOwners = { 9: 1 };
    const owned: WorldData = { ...world, provinceAt: () => 9 };
    expect(computeArmyVisibility(s, owned, 1).get('e')).toBe('contact');
  });

  it('foreignDetailVisible: own always, others only without fog', () => {
    expect(foreignDetailVisible(state(true, []), 1, 1)).toBe(true);
    expect(foreignDetailVisible(state(true, []), 1, 2)).toBe(false);
    expect(foreignDetailVisible(state(false, []), 1, 2)).toBe(true);
  });
});
