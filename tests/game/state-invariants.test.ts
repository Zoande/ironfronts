import { describe, expect, it } from 'vitest';
import { validateWorldState } from '../../src/game/state-invariants';
import { parseGameState } from '../../src/game/state-schema';
import { GameSession } from '../../src/game/session/game-session';
import { emptyStockpile, GAME_STATE_VERSION } from '../../src/game/game-state';
import { fixture, army } from '../helpers/simulation';
import { createTransportManifestation } from '../../src/game/naval/transport';

describe('restored state invariants', () => {
  it.each([6, 7, 8])('restores legitimate Level %i resource buildings without resetting the campaign', (tier) => {
    const ctx = fixture();
    ctx.state.provinceEconomies = {10:{
      resourcePotential:{food:1,stone:1,metal:1,oil:1},baseProduction:emptyStockpile(),
      resourceBuildings:{fields:tier,quarry:tier,mine:tier,oilPump:tier},
      productionCapacity:1,constructionCapacity:1,
    }};
    ctx.state.clock.gameTimeHours = 14 * 24;
    const restored = GameSession.restore(ctx.state, ctx.world);
    expect(restored.state.clock.gameTimeHours).toBe(14 * 24);
    expect(restored.state.provinceEconomies?.[10].resourceBuildings.fields).toBe(tier);
    const reloaded = GameSession.restore(restored.snapshot(), ctx.world);
    expect(reloaded.state.provinceEconomies?.[10].resourceBuildings.oilPump).toBe(tier);
    ctx.state.provinceEconomies[10].resourceBuildings.fields = 9;
    expect(() => GameSession.restore(ctx.state,ctx.world)).toThrow();
  });

  it('rejects off-edge positions, invalid queue owners, relations, and stale counters', () => {
    const cases = [
      (ctx: ReturnType<typeof fixture>) => { ctx.state.armies.a = { ...army(), x: 150, z: 160, edge: { from: 0, to: 1 } }; },
      (ctx: ReturnType<typeof fixture>) => { ctx.state.productionQueues[10] = [{ id: 'ord-11', ownerCountryId: 2, unitTypeId: 'infantry', progressHours: 0, totalHours: 1 }]; },
      (ctx: ReturnType<typeof fixture>) => { ctx.state.provinceOwners[10] = 0; ctx.state.rallyPoints[10] = { x: 100, z: 100 }; },
      (ctx: ReturnType<typeof fixture>) => { ctx.state.relations['2:1'] = 'war'; },
      (ctx: ReturnType<typeof fixture>) => { ctx.state.armies['army-12'] = army('army-12'); ctx.state.nextArmyId = 12; },
    ];
    for (const corrupt of cases) {
      const ctx = fixture(); corrupt(ctx);
      expect(() => validateWorldState(ctx)).toThrow();
    }
  });

  it('strips retired and unknown fields from a current save', () => {
    const ctx = fixture();
    const old = structuredClone(ctx.state) as unknown as Record<string, unknown>;
    old.version = GAME_STATE_VERSION;
    (old.clock as Record<string, unknown>).gameTimeHours = 1;
    (old.clock as Record<string, unknown>).combatCadence = 99;
    old.provinceDevastation = { 10: 2 };
    old.outcome = { result: 'victory', reason: 'done', atGameHours: 1 };
    const crossing = army();
    crossing.status = 'embarking';
    crossing.navalCrossing = { fromNodeId: 0, toNodeId: 1, hoursRemaining: 1 };
    old.armies = { a: crossing };
    const migrated = parseGameState(old);
    expect(migrated.version).toBe(GAME_STATE_VERSION);
    expect(migrated.clock.gameTimeHours).toBe(1);
    expect(migrated.clock).not.toHaveProperty('combatCadence');
    expect(migrated.provinceDevastation?.[10]).toBe(2);
    expect(migrated).not.toHaveProperty('outcome');
    expect(migrated.armies.a.navalCrossing?.hoursRemaining).toBe(1);
    expect(parseGameState(migrated).clock.gameTimeHours).toBe(1);
  });

  it('rejects a persisted transport whose ship pool disagrees with its cargo HP', () => {
    const ctx = fixture();
    const crossing = army();
    crossing.status = 'embarking';
    crossing.navalCrossing = { fromNodeId: 0, toNodeId: 1, hoursRemaining: 1 };
    crossing.transport = createTransportManifestation(crossing, 1);
    crossing.transport.cargo[0].shipHp[0] = 1;
    ctx.state.armies = { a: crossing };
    expect(() => parseGameState(ctx.state)).toThrow(/transport manifestation/i);
  });
});
