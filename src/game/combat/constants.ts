/** Shared v2 combat tuning constants. */
export const COMBAT_FRONTAGE = 10;
export const COMBAT_SNAP = 26;
/**
 * One legacy volley arrived every 18,000 base simulation ticks. At 0.05
 * game-hours per tick that represented 900 game-hours of damage. Catalog
 * profiles divide the old volley values by this duration so battle resolution
 * stays close to the original tuning while damage is integrated continuously.
 */
export const LEGACY_VOLLEY_GAME_HOURS = 18_000 * 0.05;
