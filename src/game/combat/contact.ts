import type { ArmyStack } from '../units/army';
import { wrappedDistance } from '../geometry';
import { COMBAT_SNAP } from './constants';

/** Numerical allowance only; the gameplay contact radius remains 26 units. */
export const CONTACT_EPSILON = 1e-6;
export function canEnterCloseCombat(army: ArmyStack): boolean {
  return !army.retreat?.protected && army.status !== 'embarking'
    && army.status !== 'atSea' && army.status !== 'disembarking';
}
export function armiesInContact(a: ArmyStack, b: ArmyStack, width: number): boolean {
  return wrappedDistance(a.x, a.z, b.x, b.z, width) <= COMBAT_SNAP + CONTACT_EPSILON;
}
export function contactPairKey(a: string, b: string): string {
  return JSON.stringify(a < b ? [a,b] : [b,a]);
}
