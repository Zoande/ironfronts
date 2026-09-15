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
  // buildOptions is the full building catalog — it never drops a building for
  // being the wrong phase, it flags it with a reason. Province 11 starts with
  // none built, and the fixture country has no funds, so every option also
  // fails affordability; the phase gate is visible only in its `reason` text.
  it('flags Tank Plant / Ordnance with a phase reason at province 11 before any qualifying industry exists (Phase I)', () => {
    const ctx = fixture();
    ctx.state.countries[1].phase = 1;
    const opts = buildOptions(ctx, 11, 1);
    const reasonFor = (id: string) => opts.find((o) => o.id === id)?.reason;
    expect(reasonFor('barracks')).toBe('Insufficient resources.'); // phase 1 met
    expect(reasonFor('tankPlant')).toBe('Requires phase 2.');
    expect(reasonFor('ordnance')).toBe('Requires phase 2.');
    // Missile Site also requires Hybrid technology Level 8, checked before
    // phase — that gate wins regardless of the country's phase.
    expect(reasonFor('missileSite')).toBe('Requires Hybrid technology Level 8.');
  });

  it('clears the phase reason for Tank Plant / Ordnance at province 11 once the country reaches Phase III', () => {
    const ctx = fixture();
    ctx.state.countries[1].phase = 3;
    const opts = buildOptions(ctx, 11, 1);
    const reasonFor = (id: string) => opts.find((o) => o.id === id)?.reason;
    expect(reasonFor('barracks')).toBe('Insufficient resources.');
    expect(reasonFor('tankPlant')).toBe('Insufficient resources.'); // phase met, only cost blocks it now
    expect(reasonFor('ordnance')).toBe('Insufficient resources.');
    expect(reasonFor('missileSite')).toBe('Requires Hybrid technology Level 8.'); // tech gate persists regardless of phase
  });

  it('BUILDING_REQUIRED_PHASE matches the intended tiering', () => {
    expect(BUILDING_REQUIRED_PHASE.barracks).toBe(1);
    expect(BUILDING_REQUIRED_PHASE.tankPlant).toBe(2);
    expect(BUILDING_REQUIRED_PHASE.ordnance).toBe(2);
    expect(BUILDING_REQUIRED_PHASE.missileSite).toBe(3);
  });
});
