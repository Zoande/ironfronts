import { describe, expect, it } from 'vitest';
import { fixture, army } from '../helpers/simulation';
import { setRelation } from '../../src/game/game-state';
import { stepCombat } from '../../src/game/combat';
import { regenOrganization } from '../../src/game/combat/organization';
import { stepEntrenchment } from '../../src/game/combat/entrenchment';
import { armySupplyPlan, stepSupply, SUPPLY_RANGE } from '../../src/game/combat/supply';

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
  it('allocates army capacity by each unit upkeep ratio', () => {
    const plan = armySupplyPlan(army('a', 1, 100, 100, 0, 'engineer', 1));
    expect(plan.capacity).toBe(100);
    expect(plan.allocation.funds).toBeCloseTo(56);
    expect(plan.allocation.food).toBeCloseTo(40);
    expect(plan.allocation.metal).toBeCloseTo(4);
  });

  it('activates only the resource-specific shortage when its army store empties', () => {
    const ctx = fixture();
    const cutOff = army('cutOff', 1, 100 + SUPPLY_RANGE * 3, 100 + SUPPLY_RANGE * 3, 0, 'engineer');
    ctx.state.armies = { cutOff };
    stepSupply(ctx, 1_000);
    expect(cutOff.inSupply).toBe(false);
    expect(cutOff.supplyStores?.metal).toBe(0);
    expect(cutOff.shortageSeverity).toMatchObject({ metal: 100, funds: 100, food: 100, oil: 0 });
  });

  it('an out-of-supply army regains organization more slowly than a supplied one', () => {
    const ctx = fixture();
    ctx.state.armies = {
      supplied: { ...army('supplied', 1), status: 'idle', organization: 50, inSupply: true },
      cutOff: { ...army('cutOff', 1), status: 'idle', organization: 50, inSupply: false },
    };
    regenOrganization(ctx, 2);
    expect(ctx.state.armies.cutOff.organization!).toBeGreaterThan(50);
    expect(ctx.state.armies.cutOff.organization!).toBeLessThan(ctx.state.armies.supplied.organization!);
  });

  it('an out-of-supply army digs in more slowly than a supplied one', () => {
    const ctx = fixture();
    ctx.state.armies = {
      supplied: { ...army('supplied', 1), status: 'idle', entrenchment: 0, inSupply: true },
      cutOff: { ...army('cutOff', 1), status: 'idle', entrenchment: 0, inSupply: false },
    };
    stepEntrenchment(ctx, 5);
    expect(ctx.state.armies.cutOff.entrenchment!).toBeGreaterThan(0);
    expect(ctx.state.armies.cutOff.entrenchment!).toBeLessThan(ctx.state.armies.supplied.entrenchment!);
  });

  it('an out-of-supply defender loses a fight it would otherwise have won', () => {
    const setup = (defenderInSupply: boolean) => {
      const ctx = fixture();
      ctx.state.armies = {
        // Numerically equal forces; supply state alone should decide it.
        garrison: { ...army('garrison', 1, 100, 100, 0, 'infantry', 50), inSupply: defenderInSupply },
        attacker: army('attacker', 2, 100, 100, 0, 'infantry', 50),
      };
      ctx.state.provinceOwners = { 10: 1, 11: 0, 12: 0, 13: 0 };
      setRelation(ctx.state, 1, 2, 'war');
      return ctx;
    };
    const supplied = setup(true);
    const cutOff = setup(false);
    for (let hour = 0; hour < 5; hour += 1) {
      supplied.state.simulationTick += 1; stepCombat(supplied, 1);
      cutOff.state.simulationTick += 1; stepCombat(cutOff, 1);
    }
    const garrisonHp = (ctx: typeof supplied) => ctx.state.armies.garrison
      ? ctx.state.armies.garrison.units.reduce((sum, g) => sum + g.hp, 0) : 0;
    expect(garrisonHp(cutOff)).toBeLessThan(garrisonHp(supplied));
  });
});
