/**
 * Combat stances: a player-chosen posture per army that trades off attack
 * output, defensive toughness, and retreat timing.
 * Every multiplier here is 1 (no effect) for 'attack-defend', the
 * default balanced stance, so choosing a stance is always a deliberate
 * trade-off rather than a strict upgrade.
 */
import type { ArmyStance } from '../units/army';

export interface StanceModifiers {
  /** Multiplies this army's own damage output when attacking or defending. */
  readonly attackOutput: number;
  /** Multiplies damage *received* while this army is defending; <1 favours the defender. */
  readonly damageTaken: number;
  /** Multiplies the fraction of entry HP at which a side withdraws. */
  readonly hpRetreatThreshold: number;
}

const BALANCED: StanceModifiers = {
  attackOutput: 1, damageTaken: 1, hpRetreatThreshold: 1,
};

export const STANCE_MODIFIERS: Record<ArmyStance, StanceModifiers> = {
  'attack-defend': BALANCED,
  // Offensive: hits harder and retreats later.
  attack: { attackOutput: 1.25, damageTaken: 1, hpRetreatThreshold: 0.6 },
  // Defensive: reduces incoming damage.
  defend: { attackOutput: 1, damageTaken: 0.8, hpRetreatThreshold: 0.5 },
  'defend-retreat': { attackOutput: 1, damageTaken: 0.9, hpRetreatThreshold: 1.5 },
  retreat: { attackOutput: 1, damageTaken: 1, hpRetreatThreshold: 2.5 },
};

export function stanceModifiers(stance: ArmyStance | undefined): StanceModifiers {
  return STANCE_MODIFIERS[stance ?? 'attack-defend'];
}

export const STANCES: readonly ArmyStance[] = ['attack', 'attack-defend', 'defend', 'defend-retreat', 'retreat'];
