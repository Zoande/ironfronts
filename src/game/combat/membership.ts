import type { BattleFrontState } from '../game-state';

/** True only when the authoritative front lists this specific army on a side. */
export function armyParticipatesInFront(armyId: string, front: BattleFrontState): boolean {
  return front.sideA.armyIds.includes(armyId) || front.sideB.armyIds.includes(armyId);
}
