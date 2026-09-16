import { describe, expect, it } from 'vitest';
import { fixture } from '../helpers/simulation';
import { buildOptions } from '../../src/game/construction';
import { qualifyingPhaseFromBuildings, stepPhaseProgression, BUILDING_REQUIRED_PHASE } from '../../src/game/phase';

describe('qualifyingPhaseFromBuildings', () => {
  it('is Phase I with no qualifying buildings anywhere the country owns', () => {
    const ctx = fixture();
    expect(qualifyingPhaseFromBuildings(ctx.state, 1)).toBe(1);
  });

  it('is Phase II once the country owns a Tank Plant or Ordnance Workshop', () => {
    const ctx = fixture();
    ctx.state.provinceBuildings[10] = { barracks: 0, tankPlant: 1, ordnance: 0, missileSite: 0 };
    expect(qualifyingPhaseFromBuildings(ctx.state, 1)).toBe(2);
  });

  it('is Phase III once the country owns a Missile Site', () => {
    const ctx = fixture();
    ctx.state.provinceBuildings[10] = { barracks: 0, tankPlant: 0, ordnance: 0, missileSite: 1 };
    expect(qualifyingPhaseFromBuildings(ctx.state, 1)).toBe(3);
  });

  it('ignores a qualifying building in a province the country does not own', () => {
    const ctx = fixture();
    ctx.state.provinceOwners[10] = 2; // someone else's now
    ctx.state.provinceBuildings[10] = { barracks: 0, tankPlant: 1, ordnance: 0, missileSite: 0 };
    expect(qualifyingPhaseFromBuildings(ctx.state, 1)).toBe(1);
  });
});

describe('stepPhaseProgression', () => {
  it('advances a country that has since built its way to Phase II', () => {
    const ctx = fixture();
    ctx.state.countries[1].phase = 1;
    ctx.state.provinceBuildings[10] = { barracks: 0, tankPlant: 1, ordnance: 0, missileSite: 0 };
    stepPhaseProgression(ctx);
    expect(ctx.state.countries[1].phase).toBe(2);
  });

  it('never regresses a phase once reached, even if the qualifying building is lost', () => {
    const ctx = fixture();
    ctx.state.countries[1].phase = 3;
    // No provinceBuildings at all now — would only qualify for Phase I on its own.
    stepPhaseProgression(ctx);
    expect(ctx.state.countries[1].phase).toBe(3);
  });

  it('advances every country on time alone, well past the industrial threshold', () => {
    const ctx = fixture();
    ctx.state.countries[1].phase = 1;
    ctx.state.countries[2].phase = 1;
    ctx.state.clock.gameTimeHours = 90 * 24; // ~90 game-days
    stepPhaseProgression(ctx);
    expect(ctx.state.countries[1].phase).toBe(3);
    expect(ctx.state.countries[2].phase).toBe(3);
  });
});

describe('buildOptions phase gating', () => {
  // fixture()'s province 10 already has a Barracks built, so it never
  // appears in buildOptions regardless of phase (already-built buildings are
  // filtered out for that reason, not a phase reason) — these tests use
  // province 11, which starts with none.
  it('nothing is offered at province 11 before any qualifying industry exists (Phase I)', () => {
    const ctx = fixture();
    ctx.state.countries[1].phase = 1;
    const ids = buildOptions(ctx, 11, 1).map((o) => o.id).sort();
    expect(ids).toEqual(['barracks']);
  });

  it('offers every building at province 11 once the country reaches Phase III', () => {
    const ctx = fixture();
    ctx.state.countries[1].phase = 3;
    const ids = buildOptions(ctx, 11, 1).map((o) => o.id).sort();
    expect(ids).toEqual(['barracks', 'missileSite', 'ordnance', 'tankPlant']);
  });

  it('BUILDING_REQUIRED_PHASE matches the intended tiering', () => {
    expect(BUILDING_REQUIRED_PHASE.barracks).toBe(1);
    expect(BUILDING_REQUIRED_PHASE.tankPlant).toBe(2);
    expect(BUILDING_REQUIRED_PHASE.ordnance).toBe(2);
    expect(BUILDING_REQUIRED_PHASE.missileSite).toBe(3);
  });
});
