import { describe, expect, it } from 'vitest';
import { fixture, army } from '../helpers/simulation';
import { makeGroup } from '../../src/game/units/army';
import { armyUpgradeQuote, stepArmyUpgrades } from '../../src/game/units/upgrades';
import { applyCommand } from '../../src/game/commands';
import { initialTechnologyLevels } from '../../src/game/technology';
import { parseGameState } from '../../src/game/state-schema';
import { unitType } from '../../src/game/units/unit-catalog';
import { projectFor } from '../../apps/game-server/src/projection';
import { serverMessageSchema } from '../../packages/protocol/src/index';

function setup() {
  const ctx = fixture();
  ctx.state.armies.a = army('a', 1, 100, 100, 0, 'infantry', 2);
  ctx.state.countries[1].technologies = { ...initialTechnologyLevels(), infantry: 3, armored: 2 };
  Object.keys(ctx.state.countries[1].stockpile).forEach((key) => { (ctx.state.countries[1].stockpile as unknown as Record<string, number>)[key] = 100_000; });
  return ctx;
}

describe('whole-army timed upgrades', () => {
  it('quotes all eligible troops, charges once, locks orders, and preserves damage and experience', () => {
    const c = setup(), a = c.state.armies.a;
    a.units.push(makeGroup('medium-tank', 1));
    a.units[0].hp = 150; a.units[0].experience = 4;
    const quote = armyUpgradeQuote(c, a);
    expect(quote.entries).toHaveLength(2);
    expect(quote.cost.manpower).toBeUndefined();
    const funds = c.state.countries[1].stockpile.funds;
    expect(applyCommand(c, { type: 'upgradeArmy', armyId: 'a', countryId: 1, quoteKey: quote.key }).ok).toBe(true);
    expect(c.state.countries[1].stockpile.funds).toBe(funds - quote.cost.funds!);
    for (const command of [
      { type: 'moveArmy', x: 300, z: 100 }, { type: 'stopArmy' },
      { type: 'moveArmy', x: 300, z: 100, enqueue: true },
      { type: 'splitArmy', groups: [{ typeId: 'infantry', count: 1 }], x: 300, z: 100 },
      { type: 'upgradeArmy', quoteKey: quote.key },
    ]) expect(applyCommand(c, { ...command, armyId: 'a', countryId: 1 } as never).ok).toBe(false);
    stepArmyUpgrades(c, quote.totalHours / 2);
    expect(a.units[0].typeId).toBe('infantry');
    // Combat losses while refitting must not resurrect on completion.
    a.units[0].count = 1; a.units[0].hp = 60;
    stepArmyUpgrades(c, quote.totalHours / 2);
    expect(a.upgrade).toBeNull();
    expect(a.units[0]).toMatchObject({ typeId: 'infantry-l3', count: 1, experience: 4 });
    expect(a.units[0].hp).toBeCloseTo(unitType('infantry-l3').maxHp * .6);
    expect(applyCommand(c, { type: 'moveArmy', armyId: 'a', countryId: 1, x: 300, z: 100 }).ok).toBe(true);
  });

  it('persists the remaining timer and combines converging levels without losing units', () => {
    const c = setup();
    c.state.armies.a.units.push(makeGroup('infantry-l2', 1));
    const quote = armyUpgradeQuote(c, c.state.armies.a);
    applyCommand(c, { type: 'upgradeArmy', armyId: 'a', countryId: 1, quoteKey: quote.key });
    stepArmyUpgrades(c, .1);
    Object.assign(c.state, parseGameState(JSON.parse(JSON.stringify(c.state))));
    expect(c.state.armies.a.upgrade?.remainingHours).toBeCloseTo(quote.totalHours - .1);
    stepArmyUpgrades(c, quote.totalHours);
    expect(c.state.armies.a.units).toHaveLength(1);
    expect(c.state.armies.a.units[0]).toMatchObject({ typeId: 'infantry-l3', count: 3 });
  });

  it('rejects stale quotes, insufficient funds, unresearched upgrades, and foreign ownership', () => {
    const c = setup(), a = c.state.armies.a;
    const quote = armyUpgradeQuote(c, a);
    a.units[0].count = 1; a.units[0].hp = 100;
    expect(applyCommand(c, { type: 'upgradeArmy', armyId: 'a', countryId: 1, quoteKey: quote.key }).ok).toBe(false);
    expect(applyCommand(c, { type: 'upgradeArmy', armyId: 'a', countryId: 2, quoteKey: quote.key }).ok).toBe(false);
    c.state.countries[1].stockpile.funds = 0;
    expect(armyUpgradeQuote(c, a).canStart).toBe(false);
    c.state.countries[1].technologies = initialTechnologyLevels();
    expect(armyUpgradeQuote(c, a).entries).toEqual([]);
  });

  it('sends upgrade quotes only to the owner through the validated wire protocol', () => {
    const c = setup();
    Object.assign(c.state, parseGameState(c.state));
    const own = projectFor(c.state, c.world, c.graph, 1);
    const foreign = projectFor(c.state, c.world, c.graph, 2);
    expect(own.armies.a.upgradeQuote?.entries.length).toBe(1);
    expect(foreign.armies.a.upgradeQuote).toBeUndefined();
    const message = serverMessageSchema.parse({type:'baseline',revision:0,state:own,catalogs:{units:[],buildings:[]},clock:{gameStartedAtEpochMs:0,gameEpochMs:0,serverEpochMs:0,speed:1,generation:0,utcOffsetMinutes:0}});
    expect(message.type).toBe('baseline');
    if (message.type === 'baseline') expect(message.state.armies.a.upgradeQuote).toEqual(own.armies.a.upgradeQuote);
  });
});
