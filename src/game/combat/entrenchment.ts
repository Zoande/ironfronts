/**
 * Entrenchment: stationary armies dig in and become harder to dislodge. Grows
 * while an army holds ground (idle or extracting — not moving); freezes while
 * it is actively fighting so a siege does not visibly "dig deeper" mid-battle,
 * and clears the moment it takes a move order.
 */
import type { SimContext } from '../sim-context';
import {
  ENTRENCHMENT_MAX, ENTRENCHMENT_GAIN_PER_HOUR, ENTRENCHMENT_DEFENSE_PER_POINT, ENTRENCHMENT_DEFENSE_CAP,
} from './constants';
import { stanceModifiers } from './stance';
import { supplyEffectiveness } from './supply';

export function entrenchmentDamageMultiplier(entrenchment: number): number {
  return 1 - Math.min(ENTRENCHMENT_DEFENSE_CAP, Math.max(0, entrenchment) * ENTRENCHMENT_DEFENSE_PER_POINT);
}

export function stepEntrenchment(ctx: SimContext, dtHours: number): void {
  if (dtHours <= 0) return;
  for (const army of Object.values(ctx.state.armies)) {
    if (army.status === 'idle' || army.status === 'extracting') {
      const supplyRate = supplyEffectiveness(army);
      const rate = ENTRENCHMENT_GAIN_PER_HOUR * stanceModifiers(army.stance).entrenchmentRate * supplyRate;
      army.entrenchment = Math.min(ENTRENCHMENT_MAX, (army.entrenchment ?? 0) + rate * dtHours);
    } else if (army.status !== 'engaged') {
      // Moving, retreating, or in transit: entrenchment clears. Engaged is
      // deliberately left untouched (frozen at whatever it held on entry).
      army.entrenchment = 0;
    }
  }
}
