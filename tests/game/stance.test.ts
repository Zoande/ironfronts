import { describe, expect, it } from 'vitest';
import { fixture, army } from '../helpers/simulation';
import { setRelation } from '../../src/game/game-state';
import { applyCommand } from '../../src/game/commands';
import { stepCombat } from '../../src/game/combat';
import { stepEntrenchment } from '../../src/game/combat/entrenchment';
import { stanceModifiers, STANCES } from '../../src/game/combat/stance';

describe('stanceModifiers', () => {
  it('is a no-op for the balanced default (undefined or explicit)', () => {
    const implicit = stanceModifiers(undefined);
    const explicit = stanceModifiers('attack-defend');
    for (const modifiers of [implicit, explicit]) {
      expect(modifiers.attackOutput).toBe(1);
      expect(modifiers.damageTaken).toBe(1);
      expect(modifiers.entrenchmentRate).toBe(1);
      expect(modifiers.hpRetreatThreshold).toBe(1);
    }
  });

  it('every stance is internally consistent with its own description', () => {
    // Attack hits harder but never digs in.
    expect(stanceModifiers('attack').attackOutput).toBeGreaterThan(1);
    expect(stanceModifiers('attack').entrenchmentRate).toBe(0);
    // Defend is tougher and digs in faster than balanced.
    expect(stanceModifiers('defend').damageTaken).toBeLessThan(1);
    expect(stanceModifiers('defend').entrenchmentRate).toBeGreaterThan(1);
    expect(stanceModifiers('defend-retreat').damageTaken).toBeLessThan(1);
    expect(stanceModifiers('retreat').hpRetreatThreshold).toBeGreaterThan(1);
    expect(stanceModifiers('defend').hpRetreatThreshold).toBeLessThan(1);
  });

  it('STANCES lists exactly the five stances the icon set supports', () => {
    expect([...STANCES].sort()).toEqual(
      ['attack', 'attack-defend', 'defend', 'defend-retreat', 'retreat'].sort(),
    );
  });
});

describe('setStance command', () => {
  it('changes the army\'s stance and rejects a non-owner', () => {
    const ctx = fixture();
    ctx.state.armies = { a: army('a', 1) };
    const ok = applyCommand(ctx, { type: 'setStance', countryId: 1, armyId: 'a', stance: 'defend' });
    expect(ok.ok).toBe(true);
    expect(ctx.state.armies.a.stance).toBe('defend');

    const denied = applyCommand(ctx, { type: 'setStance', countryId: 2, armyId: 'a', stance: 'attack' });
    expect(denied.ok).toBe(false);
    expect(ctx.state.armies.a.stance).toBe('defend'); // unchanged
  });
});

describe('stance effects on entrenchment', () => {
  it('an attack-postured army never digs in; a defend-postured one digs in faster than balanced', () => {
    const ctx = fixture();
    ctx.state.armies = {
      attacker: { ...army('attacker', 1), status: 'idle', entrenchment: 0, stance: 'attack' },
      balanced: { ...army('balanced', 1), status: 'idle', entrenchment: 0, stance: 'attack-defend' },
      defender: { ...army('defender', 1), status: 'idle', entrenchment: 0, stance: 'defend' },
    };
    stepEntrenchment(ctx, 5);
    expect(ctx.state.armies.attacker.entrenchment).toBe(0);
    expect(ctx.state.armies.defender.entrenchment!).toBeGreaterThan(ctx.state.armies.balanced.entrenchment!);
  });
});

describe('stance effects on retreat timing', () => {
  it('a retreat-postured defender breaks off before an otherwise-identical defend-postured one', () => {
    const attackerFor = () => army('besieger', 2, 100, 100, 0, 'infantry', 60);
    const duration = (stance: 'defend' | 'retreat'): number => {
      const ctx = fixture();
      ctx.state.armies = {
        garrison: { ...army('garrison', 1, 100, 100, 0, 'infantry', 40), stance },
        besieger: attackerFor(),
      };
      ctx.state.provinceOwners = { 10: 1, 11: 0, 12: 0, 13: 0 };
      setRelation(ctx.state, 1, 2, 'war');
      let everEngaged = false;
      for (let hour = 0; hour < 400; hour += 1) {
        ctx.state.simulationTick += 1;
        stepCombat(ctx, 1);
        const garrison = ctx.state.armies.garrison;
        if (!garrison) return hour; // destroyed outright
        if (garrison.status === 'engaged') everEngaged = true;
        else if (everEngaged) return hour; // broke off (retreated) after fighting
      }
      return 400; // never broke off within the window
    };
    expect(duration('retreat')).toBeLessThan(duration('defend'));
  });
});
