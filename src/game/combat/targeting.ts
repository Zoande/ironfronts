import type { SimContext } from '../sim-context';
import type { ArmyStack } from '../units/army';
import { armyCamouflageLevel } from '../units/army';
import { unitType } from '../units/unit-catalog';
import { computeArmyVisibility } from '../visibility';

/** Submarines hold fire unless ordered to attack, even when revealed by sonar. */
export function mayInitiateCombat(ctx: Pick<SimContext, 'state' | 'world'>, army: ArmyStack, target: ArmyStack): boolean {
  const submarine = army.units.length > 0 && army.units.every((group) => unitType(group.typeId).baseId === 'submarine');
  if (submarine && army.order?.intent !== 'attack' && army.navalTargetArmyId !== target.id) return false;
  if (!armyCamouflageLevel(target) || (target.revealedUntilHours ?? 0) > ctx.state.clock.gameTimeHours) return true;
  return computeArmyVisibility(ctx.state, ctx.world, army.ownerCountryId).get(target.id) !== 'hidden';
}
export function revealFiringArmy(ctx: Pick<SimContext, 'state'>, army: ArmyStack): void {
  if (armyCamouflageLevel(army)) army.revealedUntilHours = ctx.state.clock.gameTimeHours + 1;
}
