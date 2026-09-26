import { GAME_PACE } from '../pacing';

/** Directional combat tuning; damage is integrated continuously. */
export const COMBAT_FRONTAGE = 10;
export const COMBAT_SNAP = 26;
/** A city's shattered defences retain only 40% of their normal combat output. */
export const DEVASTATED_DEFENDER_STRENGTH_MULTIPLIER = 0.4;
export const COMBAT_DAMAGE_SCALE = GAME_PACE.combat.damageScale;
export const MIN_COMBAT_EFFECTIVENESS = 0.25;

/** Entrenchment cap — see entrenchment.ts. */
export const ENTRENCHMENT_MAX = 100;
/** Game-hours of continuous holding to reach full entrenchment (~2 days). */
export const HOURS_TO_FULL_ENTRENCHMENT = GAME_PACE.combat.hoursToFullEntrenchment;
export const ENTRENCHMENT_GAIN_PER_HOUR = ENTRENCHMENT_MAX / HOURS_TO_FULL_ENTRENCHMENT;
/** Incoming-damage reduction per entrenchment point, capped so a dug-in stack
 *  is tougher but never invulnerable. */
export const ENTRENCHMENT_DEFENSE_PER_POINT = 0.005;
export const ENTRENCHMENT_DEFENSE_CAP = 0.5;
