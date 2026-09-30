import { describe, expect, it } from 'vitest';
import { GAME_STATE_VERSION, emptyStockpile, type GameState } from '../../src/game/game-state';
import { TERRAIN_CLASS } from '../../src/game/world-data';
import type { LandGraph } from '../../src/game/movement/graph';
import type { SimContext } from '../../src/game/sim-context';
import type { WorldData, WorldProvince } from '../../src/game/world-data';
import { makeGroup, type ArmyStack } from '../../src/game/units/army';
import { stepAi } from '../../src/game/ai/simple-ai';

/**
 * A one-dimensional corridor so `applyCommand` can really path: node N sits
 * exactly on province (10 + N)'s centre, and consecutive nodes are linked.
 *
 *   AI (1)                       | enemies
 *   10 cap   11 city   12 rural  | 13 14 (c2)   15 (c3)   16 (c4)
 *   x=100    x=300     x=500     | 2000  2200    2400      2600
 */
const CENTERS = [100, 300, 500, 2000, 2200, 2400, 2600];
const URBAN = new Set([10, 11, 13]);

function corridorGraph(): LandGraph {
  const adjacency = CENTERS.map((_, i) => [i - 1, i + 1].filter((n) => n >= 0 && n < CENTERS.length));
  const edgeCost = adjacency.map((row, i) => row.map((n) => Math.abs(CENTERS[n] - CENTERS[i])));
  return {
    nodeX: Float64Array.from(CENTERS),
    nodeZ: new Float64Array(CENTERS.length).fill(100),
    adjacency,
    edgeCost,
    seaAdjacency: CENTERS.map(() => []),
    seaEdgeCost: CENTERS.map(() => []),
    component: new Int32Array(CENTERS.length),
    componentSize: [CENTERS.length],
    nodeCount: CENTERS.length,
    width: 10_000,
    height: 5_000,
  } as unknown as LandGraph;
}

function corridorWorld(): WorldData {
  const provinces: WorldProvince[] = CENTERS.map((x, i) => ({
    id: 10 + i, center: [x, 100], terrainId: 0, population: 1000,
    coastal: false, urban: URBAN.has(10 + i),
  }));
  const provinceAt = (x: number): number => {
    let best = provinces[0];
    for (const province of provinces) {
      if (Math.abs(province.center[0] - x) < Math.abs(best.center[0] - x)) best = province;
    }
    return best.id;
  };
  return {
    width: 10_000, height: 5_000,
    provinces,
    countries: [
      { id: 1, name: 'Home', color: '#fff', capitalProvinceId: 10 },
      { id: 2, name: 'Rival', color: '#f00', capitalProvinceId: 13 },
      { id: 3, name: 'Third', color: '#0f0', capitalProvinceId: 15 },
      { id: 4, name: 'Fourth', color: '#00f', capitalProvinceId: 16 },
    ],
    provinceOwner: (id: number) => (id < 13 ? 1 : 2),
    provinceAt,
    terrainClassAt: () => TERRAIN_CLASS.plain,
    connections: new Float32Array(0),
    resourceNodes: [],
  } as unknown as WorldData;
}

function country(id: number, controller: 'player' | 'ai' | 'neutral') {
  return {
    id, name: `C${id}`, color: '#fff', controller,
    stockpile: emptyStockpile(), income: emptyStockpile(), industryCapacity: 1, warheads: 0,
  };
}

/** `count` infantry of country `owner` resting on corridor node `node`. */
function stack(id: string, owner: number, node: number, count: number): ArmyStack {
  return {
    id, ownerCountryId: owner, name: id, x: CENTERS[node], z: 100, graphNodeId: node,
    units: [makeGroup('infantry', count)],
    status: 'idle', order: null, extractingNodeId: null,
  } as unknown as ArmyStack;
}

/** Country 1 is the AI; 10-12 are its provinces, 13-16 belong to rival 2. */
function makeCtx(armies: ArmyStack[]): SimContext {
  const state = {
    version: GAME_STATE_VERSION, seed: 1, scenarioId: 'OP-1939-01', mode: 'campaign',
    fogOfWar: false, economyEnabled: true,
    clock: { gameTimeHours: 500, startDate: 'x' }, simulationTick: 1,
    countries: {
      1: country(1, 'ai'), 2: country(2, 'player'), 3: country(3, 'neutral'), 4: country(4, 'neutral'),
    },
    provinceOwners: { 10: 1, 11: 1, 12: 1, 13: 2, 14: 2, 15: 2, 16: 2 },
    provinceBuildings: {}, productionQueues: {}, constructionQueues: {}, rallyPoints: {},
    armies: Object.fromEntries(armies.map((army) => [army.id, army])),
    battles: {}, battleFronts: {}, resourceNodes: {},
    relations: { '1:2': 'war' },
    diplomacyProposals: {}, diplomacyMessages: {}, nextDiplomacyId: 1,
    nextArmyId: 90, nextBattleId: 1, nextOrderId: 1, nextEventId: 1,
  } as unknown as GameState;
  return { state, graph: corridorGraph(), world: corridorWorld() };
}

describe('strategic AI: committing to a fight', () => {
  it('does not throw a weaker stack at a stronger enemy', () => {
    // 5 infantry (500hp) staged on province 12 against 10 infantry (1000hp)
    // holding the rival capital: 500 < 1.5 x 1000, so no assault.
    const spearhead = stack('ai-main', 1, 2, 5);
    const c = makeCtx([spearhead, stack('ai-cap', 1, 0, 3), stack('en-big', 2, 3, 10)]);

    stepAi(c, 2);

    expect(spearhead.order?.intent).not.toBe('attack');
    expect(spearhead.status).not.toBe('moving');
  });

  it('assaults the same province once it actually has the numbers', () => {
    const spearhead = stack('ai-main', 1, 2, 20); // 2000hp vs 1000hp defence
    const c = makeCtx([spearhead, stack('ai-cap', 1, 0, 3), stack('en-big', 2, 3, 10)]);

    stepAi(c, 2);

    expect(spearhead.order?.intent).toBe('attack');
    expect(spearhead.order?.target).toMatchObject({ kind: 'province', provinceId: 13 });
  });
});

describe('strategic AI: concentration', () => {
  it('gathers scattered stacks on one staging province instead of trickling', () => {
    // Two stacks share the capital node (so neither is its last defender) and
    // one sits in the second city. The rival is far too strong to attack.
    const a = stack('ai-a', 1, 0, 5);
    const b = stack('ai-b', 1, 0, 5);
    const d = stack('ai-d', 1, 1, 5);
    const c = makeCtx([a, b, d, stack('en-big', 2, 3, 40)]);

    stepAi(c, 2); // 2 staging orders per pass
    stepAi(c, 2); // the third follows next pass

    const ordered = [a, b, d].filter((army) => army.order !== null);
    expect(ordered).toHaveLength(3);
    // One destination, and it is our own frontier province 12 — not the enemy.
    expect(new Set(ordered.map((army) => army.order!.destX))).toEqual(new Set([500]));
    expect(ordered.every((army) => army.order!.intent === 'move')).toBe(true);
  });

  it('splits a field army out of a capital that is itself the staging point', () => {
    // A one-province nation: its only city, its capital and its staging point
    // are all the same node, so nothing can ever simply march away. It must
    // detach a column and keep the covering garrison.
    const whole = stack('ai-all', 1, 0, 20);
    const c = makeCtx([whole, stack('en-far', 2, 3, 2)]);
    for (const id of [11, 12]) c.state.provinceOwners[id] = 2;

    stepAi(c, 2);

    const detached = Object.values(c.state.armies)
      .filter((army) => army.ownerCountryId === 1 && army.id !== 'ai-all');
    expect(detached).toHaveLength(1);
    expect(detached[0].order).not.toBeNull();
    // The capital keeps its token garrison rather than emptying out.
    expect(whole.units[0].count).toBe(3);
    expect(whole.graphNodeId).toBe(0);
  });

  it('rallies rear-city production to the same staging point', () => {
    const c = makeCtx([stack('ai-a', 1, 2, 5), stack('en-big', 2, 3, 40)]);

    stepAi(c, 2);

    expect(c.state.rallyPoints[10]).toEqual({ x: 500, z: 100 });
  });

  it('does not let a still-scattered stack assault alone while concentration is under way', () => {
    // Three equally strong detachments start scattered on the same rear
    // city. `concentrate` only issues STAGING_ORDERS_PER_PASS (2) moves this
    // pass, so one is still standing off-staging — it must wait its turn to
    // march there, not get thrown solo at the (much weaker) rival, which is
    // what used to read as the AI "spamming" small attacks instead of
    // massing before committing.
    const a = stack('ai-a', 1, 1, 20);
    const b = stack('ai-b', 1, 1, 20);
    const leftBehind = stack('ai-c', 1, 1, 20);
    const c = makeCtx([a, b, leftBehind, stack('en-weak', 2, 3, 2)]);

    stepAi(c, 2);

    expect(a.order?.intent).toBe('move');
    expect(b.order?.intent).toBe('move');
    expect(leftBehind.order).toBeNull();
    expect(leftBehind.status).toBe('idle');
  });
});

describe('strategic AI: lost territory', () => {
  it('recaptures originally owned ground before choosing a new enemy objective', () => {
    const spearhead = stack('ai-main', 1, 1, 8);
    const c = makeCtx([spearhead, stack('ai-cap', 1, 0, 3)]);
    c.state.provinceOwners[12] = 2;

    stepAi(c, 2);

    expect(spearhead.order?.intent).toBe('attack');
    expect(spearhead.order?.target).toMatchObject({ kind: 'province', provinceId: 12 });
  });
});

describe('strategic AI: defence', () => {
  it('sends the nearest spare stack home when the capital is threatened', () => {
    // Enemy raiders sit on province 11, 200 units from an ungarrisoned capital.
    const relief = stack('ai-far', 1, 2, 6);
    const c = makeCtx([relief, stack('en-raid', 2, 1, 4)]);

    stepAi(c, 2);

    expect(relief.status).toBe('moving');
    expect(relief.order?.destX).toBe(100); // the capital's node, not the front
    expect(relief.order?.intent).toBe('move');
  });

  it('never strips the last defender off a threatened capital', () => {
    const garrison = stack('ai-cap', 1, 0, 4);
    const c = makeCtx([garrison, stack('en-raid', 2, 1, 4)]);

    stepAi(c, 2);

    expect(garrison.order).toBeNull();
    expect(garrison.graphNodeId).toBe(0);
  });
});

describe('strategic AI: breaking off', () => {
  /** An engaged AI stack and its attacker locked on province 11's node. */
  function battleAt(defenderCount: number, attackerCount: number): {
    ctx: SimContext; defender: ArmyStack;
  } {
    const defender = stack('ai-line', 1, 1, defenderCount);
    defender.status = 'engaged';
    defender.battleFrontIds = ['front-1'];
    const attacker = stack('en-atk', 2, 1, attackerCount);
    attacker.status = 'engaged';
    attacker.battleFrontIds = ['front-1'];
    const ctx = makeCtx([defender, attacker, stack('ai-cap', 1, 0, 3)]);
    ctx.state.battles = { 'battle-1': { id: 'battle-1', frontIds: ['front-1'] } };
    ctx.state.battleFronts = {
      'front-1': {
        id: 'front-1', battleId: 'battle-1', anchorNodeId: 1, kind: 'province',
        provinceId: 11, x: 300, z: 100,
        sideA: {
          countryId: 1, directionNodeId: 0, role: 'defense',
          armyIds: ['ai-line'], entryMaxHpByArmy: {},
        },
        sideB: {
          countryId: 2, directionNodeId: 2, role: 'attack',
          armyIds: ['en-atk'], entryMaxHpByArmy: {},
        },
      },
    };
    return { ctx, defender };
  }

  it('pulls a badly outnumbered stack back into friendly territory', () => {
    const { ctx, defender } = battleAt(5, 10); // 500hp against 1000hp

    stepAi(ctx, 2);

    expect(defender.status).toBe('retreating');
    // Away from the enemy's approach node (2) and onto our own capital.
    expect(defender.retreat?.destinationProvinceId).toBe(10);
    expect(defender.order?.path[0]).toBe(0);
  });

  it('holds a battle it is winning', () => {
    const { ctx, defender } = battleAt(12, 3);

    stepAi(ctx, 2);

    expect(defender.status).toBe('engaged');
    expect(defender.order).toBeNull();
  });
});

describe('strategic AI: diplomacy', () => {
  function losingOnThreeFronts(): SimContext {
    const c = makeCtx([stack('en-raid', 2, 1, 6)]); // capital threatened, no garrison
    c.state.relations = { '1:2': 'war', '1:3': 'war', '1:4': 'war' };
    c.state.provinceOwners[15] = 3;
    c.state.provinceOwners[16] = 4;
    return c;
  }

  it('sues for peace with the strongest enemy when losing a three-front war', () => {
    const c = losingOnThreeFronts();

    stepAi(c, 2);

    const pending = Object.values(c.state.diplomacyProposals ?? {});
    expect(pending).toHaveLength(1);
    // Country 2 holds two provinces to 3 and 4's one each, and is the only
    // player-controlled belligerent `proposeDiplomacy` will accept.
    expect(pending[0]).toMatchObject({
      fromCountryId: 1, toCountryId: 2, kind: 'peace', status: 'pending',
    });
  });

  it('only offers once per cooldown, not every pass', () => {
    const c = losingOnThreeFronts();

    stepAi(c, 2);
    c.state.clock.gameTimeHours += 48;
    stepAi(c, 2);

    expect(Object.values(c.state.diplomacyProposals ?? {})).toHaveLength(1);
  });

  it('accepts an incoming peace offer while losing', () => {
    const c = losingOnThreeFronts();
    c.state.diplomacyProposals = {
      'proposal-9': {
        id: 'proposal-9', fromCountryId: 2, toCountryId: 1, kind: 'peace',
        status: 'pending', createdAtTick: 0,
      },
    };

    stepAi(c, 2);

    expect(c.state.diplomacyProposals!['proposal-9'].status).toBe('accepted');
    expect(c.state.relations['1:2']).toBeUndefined(); // peace clears the key
  });

  it('refuses a peace offer while winning', () => {
    // Full territory, capital garrisoned, one weak enemy: nothing to concede.
    const c = makeCtx([stack('ai-cap', 1, 0, 8), stack('en-weak', 2, 3, 1)]);
    c.state.diplomacyProposals = {
      'proposal-9': {
        id: 'proposal-9', fromCountryId: 2, toCountryId: 1, kind: 'peace',
        status: 'pending', createdAtTick: 0,
      },
    };

    stepAi(c, 2);

    expect(c.state.diplomacyProposals!['proposal-9'].status).toBe('declined');
    expect(c.state.relations['1:2']).toBe('war');
  });
});
