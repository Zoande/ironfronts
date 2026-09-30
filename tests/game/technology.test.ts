import { describe, expect, it } from 'vitest';
import { startResearch, stepTechnology, TECHNOLOGY_HOURS_BY_LEVEL, technologyCost } from '../../src/game/technology';
import { producibleUnits, queueUnit } from '../../src/game/production';
import { UNIT_TYPE_BY_ID } from '../../src/game/units/unit-catalog';
import { fixture } from '../helpers/simulation';

describe('technology progression', () => {
  it('starts every branch at level I, charges immediately, and permits two projects', () => {
    const ctx = fixture();
    const country = ctx.state.countries[1];
    Object.assign(country.stockpile, { funds: 10_000, food: 10_000, metal: 10_000, oil: 10_000 });
    const infantryCost = technologyCost('infantry', 2);
    expect(startResearch(country, 'infantry')).toMatchObject({ ok: true });
    expect(country.researchSlots?.[0]).toMatchObject({ branch: 'infantry', targetLevel: 2, totalHours: 6 });
    expect(country.stockpile.funds).toBe(10_000 - infantryCost.funds!);
    expect(startResearch(country, 'armored')).toMatchObject({ ok: true });
    expect(country.researchSlots?.[1]).toMatchObject({ branch: 'armored', targetLevel: 2 });
    expect(startResearch(country, 'training')).toMatchObject({ ok: false, reason: 'Both research slots are occupied.' });
  });

  it('completes on game time and caps the final project at two days', () => {
    const ctx = fixture();
    const country = ctx.state.countries[1];
    Object.assign(country.stockpile, { funds: 10_000, food: 10_000, metal: 10_000, oil: 10_000 });
    startResearch(country, 'infantry');
    stepTechnology(ctx.state.countries, 5.9);
    expect(country.technologies?.infantry).toBe(1);
    stepTechnology(ctx.state.countries, 0.1);
    expect(country.technologies?.infantry).toBe(2);
    expect(country.researchSlots?.[0]).toBeNull();
    expect(TECHNOLOGY_HOURS_BY_LEVEL[8]).toBe(48);
  });

  it('advances both research slots concurrently', () => {
    const ctx = fixture();
    const country = ctx.state.countries[1];
    Object.assign(country.stockpile, { funds: 10_000, food: 10_000, metal: 10_000, oil: 10_000 });
    expect(startResearch(country, 'infantry')).toMatchObject({ ok: true });
    expect(startResearch(country, 'training')).toMatchObject({ ok: true });

    stepTechnology(ctx.state.countries, 3);
    expect(country.researchSlots?.map((slot) => slot?.progressHours)).toEqual([3, 3]);
    stepTechnology(ctx.state.countries, 3);
    expect(country.technologies).toMatchObject({ infantry: 2, training: 2 });
    expect(country.researchSlots).toEqual([null, null]);
  });

  it('does not charge anything when the immediate cost cannot be paid', () => {
    const ctx = fixture();
    const country = ctx.state.countries[1];
    Object.assign(country.stockpile, { funds: 0, food: 0, metal: 0, oil: 0 });
    const before = { ...country.stockpile };

    expect(startResearch(country, 'infantry')).toMatchObject({
      ok: false, reason: 'Insufficient resources for this research.',
    });
    expect(country.stockpile).toEqual(before);
    expect(country.researchSlots).toEqual([null, null]);
  });

  it('requires resource infrastructure before advanced engineer research', () => {
    const ctx = fixture();
    const country = ctx.state.countries[1];
    Object.assign(country.stockpile, { funds: 100_000, food: 100_000, metal: 100_000, oil: 100_000 });
    country.technologies = { infantry: 1, resources: 2, resourceBuildings: 1, training: 1, hybrid: 1, armored: 1, navy: 1 };
    expect(startResearch(country, 'resources')).toMatchObject({
      ok: false, reason: 'Requires Resource Infrastructure Level 2.',
    });
    expect(startResearch(country, 'resourceBuildings')).toMatchObject({ ok: true });
  });

  it('trains only the highest level supported by both technology and barracks', () => {
    const ctx = fixture();
    Object.assign(ctx.state.countries[1].stockpile, { funds: 1_000_000, manpower: 1_000_000, food: 1_000_000, metal: 1_000_000, oil: 1_000_000 });
    ctx.state.countries[1].technologies = { infantry: 4, resources: 1, resourceBuildings: 1, training: 4, hybrid: 1, armored: 1, navy: 1 };
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
