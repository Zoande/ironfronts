import { describe, expect, it } from 'vitest';
import { fixture, army } from '../helpers/simulation';
import { emptyStockpile, setRelation } from '../../src/game/game-state';
import { stepCombat } from '../../src/game/combat';
import { stepEntrenchment } from '../../src/game/combat/entrenchment';
import { armySupplyPlan, stepSupply, supplyEffectiveness, SUPPLY_RANGE } from '../../src/game/combat/supply';
import { mergeStacks } from '../../src/game/units/army';
import { applyCommand } from '../../src/game/commands';

describe('stepSupply', () => {
  it('an army standing on its own territory is in supply', () => {
    const ctx = fixture();
    // fixture() already owns every province (10-13) to country 1.
    ctx.state.armies = { a: army('a', 1, 100, 100, 0) };
    stepSupply(ctx);
    expect(ctx.state.armies.a.inSupply).toBe(true);
  });

  it('an army far beyond any owned province is out of supply', () => {
    const ctx = fixture();
    ctx.state.armies = { a: army('a', 1, 100, 100, 0) };
    // Push it well past SUPPLY_RANGE from every owned province center
    // (10@[100,100], 11@[300,100], 12@[100,300], 13@[500,100]).
    ctx.state.armies.a.x = 100 + SUPPLY_RANGE * 3;
    ctx.state.armies.a.z = 100 + SUPPLY_RANGE * 3;
    stepSupply(ctx);
    expect(ctx.state.armies.a.inSupply).toBe(false);
  });

  it('a country that owns no territory at all leaves its armies out of supply', () => {
    const ctx = fixture();
    ctx.state.provinceOwners = { 10: 2, 11: 2, 12: 2, 13: 2 }; // none owned by country 1
    ctx.state.armies = { a: army('a', 1, 100, 100, 0) };
    stepSupply(ctx);
    expect(ctx.state.armies.a.inSupply).toBe(false);
  });

  it('is within reach just past the border, not only directly on owned ground', () => {
    const ctx = fixture();
    ctx.state.armies = { a: army('a', 1, 100, 100, 0) };
    ctx.state.armies.a.x = 100 + SUPPLY_RANGE * 0.5;
    stepSupply(ctx);
    expect(ctx.state.armies.a.inSupply).toBe(true);
  });
});

describe('supply effects', () => {
  it('uses one capacity and one upkeep rate for the whole army', () => {
    const plan = armySupplyPlan(army('a', 1, 100, 100, 0, 'engineer', 1));
    expect(plan.capacity).toBe(100);
    expect(plan.upkeepPerHour).toBeCloseTo(1.25);
  });

  it('consumes the single reserve while disconnected', () => {
    const ctx = fixture();
    const cutOff = army('cutOff', 1, 100 + SUPPLY_RANGE * 3, 100 + SUPPLY_RANGE * 3, 0, 'engineer');
    ctx.state.armies = { cutOff };
    stepSupply(ctx, 1_000);
    expect(cutOff.inSupply).toBe(false);
    expect(cutOff.supply).toBe(0);
    expect(supplyEffectiveness(cutOff)).toBe(0.4);
  });

  it('reduces refill by 20% for each empty resource with negative flow', () => {
    const ctx = fixture();
    const supplied = army('supplied', 1, 100, 100, 0, 'engineer', 1);
    supplied.supply = 0;
    ctx.state.armies = { supplied };
    const country = ctx.state.countries[1];
    country.stockpile = { ...emptyStockpile(), funds: 1, food: 1, metal: 1, oil: 1 };
    country.netIncome = { ...emptyStockpile(), funds: -1, food: -1, metal: -1, oil: -1 };
    stepSupply(ctx, 0.25);
    expect(supplied.supply).toBeCloseTo(25);
    supplied.supply = 0;
    country.stockpile.funds = 0;
    stepSupply(ctx, 0.25);
    expect(supplied.supply).toBeCloseTo(20);
    supplied.supply = 0;
    country.stockpile.food = 0;
    country.stockpile.metal = 0;
    country.stockpile.oil = 0;
    stepSupply(ctx, 0.25);
    expect(supplied.supply).toBeCloseTo(5);
    supplied.supply = 0;
    country.netIncome.funds = 0;
    stepSupply(ctx, 0.25);
    expect(supplied.supply).toBeCloseTo(10);
  });

  it('uses shared penalties at supply thresholds', () => {
    const stack = army('a', 1, 100, 100, 0, 'infantry', 1);
    for (const [current, expected] of [[100, 1], [74, 0.9], [49, 0.75], [24, 0.6], [0, 0.4]]) {
      stack.supply = current;
      expect(supplyEffectiveness(stack)).toBe(expected);
    }
  });

  it('combines reserves when armies merge', () => {
    const target = army('target', 1, 100, 100, 0, 'infantry', 1);
    const source = army('source', 1, 100, 100, 0, 'engineer', 1);
    target.supply = 40;
    source.supply = 25;
    mergeStacks(target, source);
    expect(target.supplyCapacity).toBe(200);
    expect(target.supply).toBe(65);
    expect(source.supply).toBe(0);
  });

  it('divides the reserve proportionally when an army splits', () => {
    const ctx = fixture();
    const parent = army('parent', 1, 100, 100, 0, 'infantry', 2);
    parent.supply = 80;
    ctx.state.armies = { parent };
    const result = applyCommand(ctx, { type: 'splitArmy', countryId: 1, armyId: 'parent',
      groups: [{ typeId: 'infantry', count: 1 }], x: 300, z: 100 });
    expect(result.ok).toBe(true);
    const child = ctx.state.armies[result.armyId!];
    expect(parent.supply).toBe(40);
    expect(child.supply).toBe(40);
    expect(parent.supplyCapacity).toBe(100);
    expect(child.supplyCapacity).toBe(100);
  });

  it('an out-of-supply army digs in more slowly than a supplied one', () => {
    const ctx = fixture();
    ctx.state.armies = {
      supplied: { ...army('supplied', 1), status: 'idle', entrenchment: 0, supply: 100, supplyCapacity: 100 },
      cutOff: { ...army('cutOff', 1), status: 'idle', entrenchment: 0, supply: 0, supplyCapacity: 100 },
    };
    stepEntrenchment(ctx, 5);
    expect(ctx.state.armies.cutOff.entrenchment!).toBeGreaterThan(0);
    expect(ctx.state.armies.cutOff.entrenchment!).toBeLessThan(ctx.state.armies.supplied.entrenchment!);
  });

  it('an out-of-supply defender loses a fight it would otherwise have won', () => {
    const setup = (defenderSupply: number) => {
      const ctx = fixture();
      ctx.state.armies = {
        // Numerically equal forces; supply level alone should decide it.
        garrison: { ...army('garrison', 1, 100, 100, 0, 'infantry', 50), supply: defenderSupply, supplyCapacity: 5_000 },
        attacker: army('attacker', 2, 100, 100, 0, 'infantry', 50),
      };
      ctx.state.provinceOwners = { 10: 1, 11: 0, 12: 0, 13: 0 };
      setRelation(ctx.state, 1, 2, 'war');
      return ctx;
    };
    const supplied = setup(5_000);
    const cutOff = setup(0);
    for (let hour = 0; hour < 5; hour += 1) {
      supplied.state.simulationTick += 1; stepCombat(supplied, 1);
      cutOff.state.simulationTick += 1; stepCombat(cutOff, 1);
    }
    const garrisonHp = (ctx: typeof supplied) => ctx.state.armies.garrison
      ? ctx.state.armies.garrison.units.reduce((sum, g) => sum + g.hp, 0) : 0;
    expect(garrisonHp(cutOff)).toBeLessThan(garrisonHp(supplied));
  });
});
