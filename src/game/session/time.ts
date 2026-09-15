import { GAME_PACE } from './pacing';

/** All gameplay durations are hours on the authoritative 1:1 simulation timeline. */
export const SECONDS_PER_HOUR = 3_600;
/** Live server pump cadence. The integrator may combine these at fast-forward. */
export const FIXED_STEP_SECONDS = 0.1;
export const FIXED_STEP_HOURS = FIXED_STEP_SECONDS / SECONDS_PER_HOUR;
export const MAX_SIMULATION_STEP_SECONDS = GAME_PACE.clock.maximumIntegrationStepSeconds;
export const MAX_SIMULATION_STEP_HOURS = MAX_SIMULATION_STEP_SECONDS / SECONDS_PER_HOUR;
/** @deprecated Fixture/migration compatibility only. No runtime pacing code may use this. */
export const PROTOTYPE_HOURS_PER_HOUR = 1_800;
export const INITIAL_GAME_EPOCH_MS = Date.UTC(1939, 8, 1, 10);

export function gameEpochMs(clock: { gameTimeHours: number; initialEpochMs?: number }): number {
  return (clock.initialEpochMs ?? INITIAL_GAME_EPOCH_MS) + clock.gameTimeHours * 3_600_000;
}
