import { GAME_PACE } from '../pacing';

/** Directional combat tuning; damage is integrated continuously. */
export const COMBAT_FRONTAGE = 10;
export const COMBAT_SNAP = 26;
/** A city's shattered defences retain only 40% of their normal combat output. */
export const DEVASTATED_DEFENDER_STRENGTH_MULTIPLIER = 0.4;
export const COMBAT_DAMAGE_SCALE = GAME_PACE.combat.damageScale;
export const MIN_COMBAT_EFFECTIVENESS = 0.25;
