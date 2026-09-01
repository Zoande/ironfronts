/** Existing authoritative gameplay cadence: ten fixed simulation steps/sec. */
export const SIMULATION_INTERVAL_MS = 100;
/** Existing gameplay delta per step. Movement/economy balance depends on it. */
export const SIMULATION_TICK_HOURS = 0.5 / 10;

/** Civil-clock corrections are sparse; interpolation happens in the browser. */
export const CLOCK_SYNC_INTERVAL_MS = 60_000;

/** Dev/test simulation-speed multiplier bounds. 0 pauses; 32 is the fastest
 *  fast-forward that stays numerically stable for the fixed step above. */
export const MIN_SIM_SPEED = 0;
export const MAX_SIM_SPEED = 32;
/** Clamp a requested dev sim-speed multiplier; non-finite falls back to 1. */
export function clampSimSpeed(multiplier: number): number {
  if (!Number.isFinite(multiplier)) return 1;
  return Math.max(MIN_SIM_SPEED, Math.min(MAX_SIM_SPEED, multiplier));
}
