/**
 * The player-facing projection must not leak secret state:
 *   - a foreign stack at CONTACT range projects position + owner but no
 *     composition, name, speed or status;
 *   - a HIDDEN foreign stack does not project at all;
 *   - the deposit set the player may see excludes foreign nodes outside vision.
 */

import { describe, expect, it } from 'vitest';
import { GAME_STATE_VERSION, emptyStockpile, type GameState, type ResourceNodeState } from '../../src/game/game-state';
import type { WorldData } from '../../src/game/world-data';
import { makeGroup, type ArmyStack } from '../../src/game/units/army';
import { projectArmyView, visibleResourceNodes } from '../../src/game/player-view';

function army(id: string, owner: number, x: number, z: number): ArmyStack {
  return {
    id, ownerCountryId: owner, name: `${id} Detachment`, x, z, graphNodeId: 0,
    units: [makeGroup('infantry', 4)], status: 'moving', order: null, extractingNodeId: null,
  };
}

function node(id: number, controller: number, x: number, z: number): ResourceNodeState {
  return {
    id, kind: 'metal', x, z, remaining: 100, initialAmount: 100,
    controllerCountryId: controller, provinceId: id, accessNodeId: -1,
    extractorArmyId: null, status: 'idle', provenance: 'generatedNatural',
  };
}

function state(fog: boolean, armies: ArmyStack[], nodes: ResourceNodeState[] = []): GameState {
  return {
    version: GAME_STATE_VERSION, seed: 1, scenarioId: 'OP-1939-01', mode: 'campaign',
    fogOfWar: fog, economyEnabled: true,
    clock: { gameTimeHours: 0, startDate: 'x' }, simulationTick: 0,
    countries: {
      1: { id: 1, name: 'A', color: '#fff', controller: 'player', stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1 },
      2: { id: 2, name: 'B', color: '#000', controller: 'ai', stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1 },
    },
    provinceOwners: {}, provinceBuildings: {}, productionQueues: {}, constructionQueues: {}, rallyPoints: {},
    armies: Object.fromEntries(armies.map((a) => [a.id, a])),
    resourceNodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    relations: {}, battles: {}, battleFronts: {},
    nextArmyId: 99, nextBattleId: 1, nextOrderId: 1, nextEventId: 1,
  };
}

const world: WorldData = {
  width: 10_000, height: 5_000, provinces: [], countries: [],
  provinceOwner: () => 0, provinceAt: () => -1, terrainClassAt: () => -1,
  connections: new Float32Array(0), resourceNodes: [],
};

// Infantry: visionOuter 180, visionInner 90.
describe('projectArmyView', () => {
  it('gives full composition for an own stack', () => {
    const s = state(true, [army('p', 1, 0, 0)], []);
    const v = projectArmyView(s, world, 1, 'p')!;
    expect(v.own).toBe(true);
    expect(v.composition).not.toBeNull();
    expect(v.composition!.unitCount).toBe(4);
    expect(v.name).toBe('p Detachment');
  });

  it('withholds composition and name for a contact-range foreign stack', () => {
    const s = state(true, [army('p', 1, 0, 0), army('e', 2, 140, 0)]); // 90 < 140 < 180
    const v = projectArmyView(s, world, 1, 'e')!;
    expect(v.contact).toBe('contact');
    expect(v.composition).toBeNull();
    expect(v.status).toBe('unknown');
    expect(v.name).toBe('Unidentified force');
    expect(v.moveOrder).toBeNull();
    // owner + position are still known
    expect(v.ownerCountryId).toBe(2);
    expect(v.x).toBe(140);
  });

  it('reveals composition once a foreign stack is inside inner vision', () => {
    const s = state(true, [army('p', 1, 0, 0), army('e', 2, 70, 0)]); // < 90
    const v = projectArmyView(s, world, 1, 'e')!;
    expect(v.contact).toBe('visible');
    expect(v.composition!.unitCount).toBe(4);
  });

  it('reveals the oriented combat overview for a fully identified foreign stack', () => {
    const player = army('p', 1, 0, 0);
    const foreign = army('e', 2, 70, 0);
    player.status = 'engaged';
    foreign.status = 'engaged';
    player.battleFrontIds = ['front-1'];
    foreign.battleFrontIds = ['front-1'];
    const s = state(true, [player, foreign]);
    s.battles['battle-1'] = { id: 'battle-1', frontIds: ['front-1'] };
    s.battleFronts['front-1'] = {
      id: 'front-1', battleId: 'battle-1', anchorNodeId: 0, kind: 'road', provinceId: null, x: 35, z: 0,
      sideA: {
        countryId: 1, directionNodeId: 0, role: 'defense', armyIds: ['p'],
        entryMaxHpByArmy: { p: 400 },
      },
      sideB: {
        countryId: 2, directionNodeId: 0, role: 'attack', armyIds: ['e'],
        entryMaxHpByArmy: { e: 400 },
      },
    };

    const v = projectArmyView(s, world, 1, 'e')!;
    expect(v.own).toBe(false);
    expect(v.battleFronts).toHaveLength(1);
    expect(v.battleFronts![0]).toMatchObject({
      role: 'attack', friendlyBaselineHp: 400, enemyBaselineHp: 400,
    });
  });

  it('does not project a hidden foreign stack at all', () => {
    const s = state(true, [army('p', 1, 0, 0), army('e', 2, 400, 0)]);
    expect(projectArmyView(s, world, 1, 'e')).toBeNull();
  });
});

describe('visibleResourceNodes', () => {
  it('shows own-controlled nodes and nodes in friendly vision, hides the rest', () => {
    const s = state(true, [army('p', 1, 0, 0)], [
      node(1, 1, 5_000, 2_000),   // own-controlled, far away -> visible
      node(2, 2, 60, 0),          // foreign but under the player's army -> visible
      node(3, 2, 5_000, 2_000),   // foreign, no vision -> hidden
    ]);
    const ids = visibleResourceNodes(s, world, 1).map((n) => n.id).sort();
    expect(ids).toEqual([1, 2]);
  });

  it('shows every node when fog is off', () => {
    const s = state(false, [], [node(1, 2, 0, 0), node(2, 2, 9_000, 4_000)]);
    expect(visibleResourceNodes(s, world, 1)).toHaveLength(2);
  });
});
