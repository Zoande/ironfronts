/**
 * Progression tiers, 0 A.D.-style but Ironfronts-shaped: a country starts at
 * Phase I (Local Command) and advances to Phase II (Industrial Mobilization)
 * and Phase III (Total War) as it either invests in the qualifying industry
 * or as the war simply goes on long enough. Advancement is automatic and
 * monotonic — there is no player action to "click," and it can never go
 * backwards or get stuck, so it never becomes a trap state.
 *
 * Gating (see BUILDING_REQUIRED_PHASE) only touches which buildings can be
 * *newly started*. `qualifyingPhaseFromBuildings` is also the migration path
 * for existing saves: a country's initial phase is computed from what it has
 * already built, so nobody's existing Ordnance Workshop or Missile Site is
 * retroactively invalidated by this feature landing.
 */
import type { GameState } from './game-state';
import type { SimContext } from './sim-context';
import type { MilitaryBuildingId } from './units/unit-types';
import { GAME_PACE } from './pacing';

export const PHASE_MAX = 3;

export const PHASE_LABELS: Record<number, string> = {
  1: 'Phase I — Local Command',
  2: 'Phase II — Industrial Mobilization',
  3: 'Phase III — Total War',
};

/** Minimum phase required to *start* each building. Barracks is available
 *  from turn one; the heavier industrial and strategic buildings require the
 *  country to have reached the matching tier first. */
export const BUILDING_REQUIRED_PHASE: Record<MilitaryBuildingId, number> = {
  barracks: 1,
  tankPlant: 2,
  ordnance: 2,
  missileSite: 3,
};

/** Game-hours before Phase II / III unlock on their own even without the
 *  qualifying industry, so a country that never builds heavy industry isn't
 *  permanently stuck at Phase I. Current pacing: 72 h (~3 days) and 168 h (~7 days). */
const PHASE_2_TIME_HOURS = GAME_PACE.strategic.phase2FallbackHours;
const PHASE_3_TIME_HOURS = GAME_PACE.strategic.phase3FallbackHours;

/** The phase a country's own buildings already qualify it for, independent of
 *  elapsed time — used both to migrate existing saves and, every tick, to let
 *  a country advance early by actually building its way there. */
export function qualifyingPhaseFromBuildings(state: GameState, countryId: number): number {
  let hasIndustrial = false;
  let hasMissileSite = false;
  for (const [provinceId, buildings] of Object.entries(state.provinceBuildings)) {
    if (state.provinceOwners[Number(provinceId)] !== countryId) continue;
    if (buildings.tankPlant > 0 || buildings.ordnance > 0) hasIndustrial = true;
    if (buildings.missileSite > 0) hasMissileSite = true;
  }
  if (hasMissileSite) return 3;
  if (hasIndustrial) return 2;
  return 1;
}

function qualifyingPhaseFromTime(gameTimeHours: number): number {
  if (gameTimeHours >= PHASE_3_TIME_HOURS) return 3;
  if (gameTimeHours >= PHASE_2_TIME_HOURS) return 2;
  return 1;
}

/** Advance (never regress) every country's phase to whatever it now
 *  qualifies for by buildings or by elapsed time, whichever is further. */
export function stepPhaseProgression(ctx: SimContext): void {
  const timePhase = qualifyingPhaseFromTime(ctx.state.clock.gameTimeHours);
  for (const country of Object.values(ctx.state.countries)) {
    const qualifies = Math.max(qualifyingPhaseFromBuildings(ctx.state, country.id), timePhase);
    if (qualifies > (country.phase ?? 1)) country.phase = qualifies;
  }
}
