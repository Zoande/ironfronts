/** Typed province/army attack handling, including artillery-only targeting. */

import type { SimContext } from '../sim-context';
import { ensureArmyRuntimeState } from '../units/army';
import { unitType } from '../units/unit-catalog';
import { issueMoveOrder } from '../units/movement';
import { computeArmyVisibility } from '../visibility';
import { relationOf, setRelation } from '../game-state';
import { wrappedDistance } from '../geometry';
import type { AttackCommand, CommandResult } from './types';

export function issueAttack(ctx: SimContext, command: AttackCommand): CommandResult {
  const army = ctx.state.armies[command.armyId];
  ensureArmyRuntimeState(army);
  const artilleryOnly = army.units.length > 0
    && army.units.every((group) => unitType(group.typeId).category === 'artillery');
  if (command.target.kind === 'province') {
    if (artilleryOnly) {
      return { ok: false, reason: 'Artillery-only armies must select an enemy currently in range.' };
    }
    const provinceId = command.target.provinceId;
    const province = ctx.world.provinces.find((item) => item.id === provinceId);
    if (!province) return { ok: false, reason: 'No such province.' };
    const hasClickPoint = command.target.x !== undefined && command.target.z !== undefined;
    if ((command.target.x === undefined) !== (command.target.z === undefined)) {
      return { ok: false, reason: 'Attack point is incomplete.' };
    }
    const destinationX = hasClickPoint ? command.target.x! : province.center[0];
    const destinationZ = hasClickPoint ? command.target.z! : province.center[1];
    if (hasClickPoint && ctx.world.provinceAt(destinationX, destinationZ) !== provinceId) {
      return { ok: false, reason: 'Attack point does not belong to that province.' };
    }
    // You cannot order a strike on ground you already hold. The client normally
    // routes a right-click on own territory to a plain move; this is the
    // server-side backstop for a modified or out-of-sync client.
    if ((ctx.state.provinceOwners[province.id] ?? 0) === army.ownerCountryId) {
      return { ok: false, reason: 'You already hold that province — move there instead.' };
    }
    return issueMoveOrder(
      ctx, army.id, destinationX, destinationZ, 'attack',
      { kind: 'province', provinceId: province.id, x: destinationX, z: destinationZ },
      command.confirmedWarCountryIds,
      [ctx.state.provinceOwners[province.id] ?? 0],
    );
  }

  const target = ctx.state.armies[command.target.armyId];
  if (!target) return { ok: false, reason: 'No such target army.' };
  // No alliance system yet, so "friendly" is exactly "same country". A strike on
  // your own force is always rejected here regardless of what the client sent.
  if (target.ownerCountryId === army.ownerCountryId) {
    return { ok: false, reason: 'That is one of your own forces.' };
  }
  const contact = computeArmyVisibility(ctx.state, ctx.world, army.ownerCountryId).get(target.id);
  // Any currently detected contact can be targeted. Its detailed composition
  // remains redacted by the projection, but its map position is actionable.
  if (!contact || contact === 'hidden') return { ok: false, reason: 'Target is no longer detected.' };
  const required = relationOf(ctx.state, army.ownerCountryId, target.ownerCountryId) === 'war'
    ? [] : [target.ownerCountryId];
  if (required.some((id) => !command.confirmedWarCountryIds?.includes(id))) {
    return { ok: false, reason: 'War declaration required.', requiredWarCountryIds: required };
  }

  if (artilleryOnly) {
    if (army.status !== 'idle' && army.status !== 'extracting') {
      return { ok: false, reason: 'Artillery must be stationary.' };
    }
    const range = Math.max(...army.units.map((group) => unitType(group.typeId).engagementRange));
    if (wrappedDistance(army.x, army.z, target.x, target.z, ctx.world.width) > range) {
      return { ok: false, reason: 'Target is outside artillery range.' };
    }
    for (const id of required) setRelation(ctx.state, army.ownerCountryId, id, 'war');
    army.artillery!.targetArmyId = target.id;
    army.artillery!.manualTarget = true;
    return { ok: true };
  }
  return issueMoveOrder(
    ctx, army.id, target.x, target.z, 'attack',
    { kind: 'army', armyId: target.id, lastKnownX: target.x, lastKnownZ: target.z },
    command.confirmedWarCountryIds, [target.ownerCountryId],
  );
}
