import { describe, expect, it } from 'vitest';
import { startResearch, stepTechnology, TECHNOLOGY_HOURS_BY_LEVEL } from '../../src/game/technology';
import { producibleUnits, queueUnit } from '../../src/game/production';
import { UNIT_TYPE_BY_ID } from '../../src/game/units/unit-catalog';
import { fixture } from '../helpers/simulation';

describe('technology progression', () => {
  it('starts every branch at level I and permits only one project', () => {
    const ctx = fixture();
    const country = ctx.state.countries[1];
    expect(startResearch(country, 'infantry')).toMatchObject({ ok: true });
    expect(country.research).toMatchObject({ branch: 'infantry', targetLevel: 2, totalHours: 6 });
    expect(startResearch(country, 'armored')).toMatchObject({ ok: false });
  });

  it('completes on game time and caps the final project at two days', () => {
    const ctx = fixture();
    const country = ctx.state.countries[1];
    startResearch(country, 'infantry');
    stepTechnology(ctx.state.countries, 5.9);
    expect(country.technologies?.infantry).toBe(1);
    stepTechnology(ctx.state.countries, 0.1);
    expect(country.technologies?.infantry).toBe(2);
    expect(country.research).toBeUndefined();
    expect(TECHNOLOGY_HOURS_BY_LEVEL[8]).toBe(48);
  });

  it('trains only the highest level supported by both technology and barracks', () => {
    const ctx = fixture();
    Object.assign(ctx.state.countries[1].stockpile, { funds: 1_000_000, manpower: 1_000_000, food: 1_000_000, metal: 1_000_000, oil: 1_000_000 });
    ctx.state.countries[1].technologies = { infantry: 4, resources: 1, training: 4, hybrid: 1, armored: 1 };
    ctx.state.provinceBuildings[10].barracks = 3;
    expect(producibleUnits(ctx, 10, 1)).toContain('infantry-l3');
    expect(producibleUnits(ctx, 10, 1)).not.toContain('infantry');
    expect(queueUnit(ctx, 10, 'infantry-l2', 1)).toMatchObject({ ok: false });
    expect(queueUnit(ctx, 10, 'infantry-l3', 1)).toMatchObject({ ok: true });
  });

  it('makes advanced variants materially stronger and slower to train', () => {
    const first = UNIT_TYPE_BY_ID.get('medium-tank')!;
    const eighth = UNIT_TYPE_BY_ID.get('medium-tank-l8')!;
    expect(first.buildTimeHours).toBe(1.25);
    expect(eighth.buildTimeHours).toBeGreaterThanOrEqual(72);
    expect(eighth.maxHp).toBeGreaterThan(first.maxHp * 2);
    expect(eighth.attack.heavy).toBeGreaterThan(first.attack.heavy * 2);
    expect(eighth.buildCost.funds).toBeGreaterThan(first.buildCost.funds! * 7);
  });
});
