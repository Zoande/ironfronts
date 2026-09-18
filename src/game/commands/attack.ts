/** Typed province/army attack handling, including artillery-only targeting. */

import type { SimContext } from '../sim-context';
import { ensureArmyRuntimeState } from '../units/army';
import { unitType } from '../units/unit-catalog';
import { issueMoveOrder } from '../units/movement';
import type { ExactMoveGoal } from '../movement/orders';
import type { ArmyStack } from '../units/army';
import { nearestRoadPosition, type LandGraph } from '../movement/graph';
import { routeFromArmy } from '../movement/position';
import { combinedGraph } from '../movement/naval';
import { computeArmyVisibility } from '../visibility';
import { relationOf, setRelation } from '../game-state';
import { wrappedDistance } from '../geometry';
import type { AttackCommand, CommandResult } from './types';
import { movementEdgeAllowed } from '../movement/policy';
import { movementEdgeTravelCost } from '../movement/speed';
import { combatDomain } from '../naval/transport';

function reachableProvinceNode(
  ctx: SimContext, army: ArmyStack, provinceId: number, targetX: number, targetZ: number,
): ({ x: number; z: number } & ExactMoveGoal) | CommandResult {
  const nodes: number[] = [];
  for (let node = 0; node < ctx.graph.nodeCount; node += 1) {
    if (ctx.world.provinceAt(ctx.graph.nodeX[node], ctx.graph.nodeZ[node]) === provinceId) nodes.push(node);
  }
  if (!nodes.length) return { ok: false, reason: 'Target is not reachable.' };
  nodes.sort((a, b) => wrappedDistance(
    ctx.graph.nodeX[a], ctx.graph.nodeZ[a], targetX, targetZ, ctx.world.width,
  ) - wrappedDistance(
    ctx.graph.nodeX[b], ctx.graph.nodeZ[b], targetX, targetZ, ctx.world.width,
  ) || a - b);
  const provinceOwner = ctx.state.provinceOwners[provinceId] ?? 0;
  const prospectiveWars = new Set(provinceOwner > 0 ? [provinceOwner] : []);
  const reachableIn = (
    graph: LandGraph, allowNeutral: boolean,
  ): ExactMoveGoal | null => {
    const allowed = allowNeutral ? undefined
      : movementEdgeAllowed(ctx, army.ownerCountryId, false, prospectiveWars);
    const cost = movementEdgeTravelCost(
      ctx, army, graph, allowNeutral
        ? new Set(Object.keys(ctx.state.countries).map(Number)) : prospectiveWars,
    );
    for (const node of nodes) {
      if (routeFromArmy(ctx, army, node, allowed, graph, cost)) return { graph, nodeId: node };
    }
    return null;
  };
  const merged = combinedGraph(ctx.graph);
  const goal = reachableIn(ctx.graph, false) ?? reachableIn(merged, false)
    ?? reachableIn(ctx.graph, true) ?? reachableIn(merged, true);
  return goal === null
    ? { ok: false, reason: 'Attack route unavailable.' }
    : { ...goal, x: ctx.graph.nodeX[goal.nodeId!], z: ctx.graph.nodeZ[goal.nodeId!] };
}

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
    const provinceOwner = ctx.state.provinceOwners[province.id] ?? 0;
    if (provinceOwner > 0 && relationOf(ctx.state, army.ownerCountryId, provinceOwner) === 'allied') {
      return { ok: false, reason: 'That province belongs to an ally — move there instead.' };
    }
    const centerClick = hasClickPoint && wrappedDistance(
      destinationX, destinationZ, province.center[0], province.center[1], ctx.world.width,
    ) <= 0.01;
    const merged = combinedGraph(ctx.graph);
    const exactRoad = hasClickPoint && !centerClick
      ? nearestRoadPosition(
        ctx.graph, destinationX, destinationZ, 600, -1,
        (x, z) => ctx.world.provinceAt(x, z) === province.id,
      ) ?? nearestRoadPosition(
        merged, destinationX, destinationZ, 600, -1,
        (x, z) => ctx.world.provinceAt(x, z) === province.id,
      ) : null;
    const destination = exactRoad
      ? { graph: ctx.graph.component[army.graphNodeId] === ctx.graph.component[exactRoad.from]
          ? ctx.graph : merged,
        roadPosition: exactRoad, x: exactRoad.x, z: exactRoad.z }
      : reachableProvinceNode(ctx, army, province.id, destinationX, destinationZ);
    if ('ok' in destination) return destination;
    return issueMoveOrder(
      ctx, army.id, destination.x, destination.z, 'attack',
      { kind: 'province', provinceId: province.id, x: destination.x, z: destination.z },
      command.confirmedWarCountryIds,
      [ctx.state.provinceOwners[province.id] ?? 0],
      destination,
    );
  }

  const target = ctx.state.armies[command.target.armyId];
  if (!target) return { ok: false, reason: 'No valid hostile force.' };
  if (target.ownerCountryId === army.ownerCountryId) return { ok: false, reason: 'That is one of your own forces.' };
  if (relationOf(ctx.state, army.ownerCountryId, target.ownerCountryId) === 'allied') {
    return { ok: false, reason: 'That is an allied force.' };
  }
  const contact = computeArmyVisibility(ctx.state, ctx.world, army.ownerCountryId).get(target.id);
  // Any currently detected contact can be targeted. Its detailed composition
  // remains redacted by the projection, but its map position is actionable.
  if (!contact || contact === 'hidden') return { ok: false, reason: 'No valid hostile force.' };
  const required = relationOf(ctx.state, army.ownerCountryId, target.ownerCountryId) === 'war'
    ? [] : [target.ownerCountryId];
  if (combatDomain(army) !== combatDomain(target)) {
    return { ok: false, reason: combatDomain(target) === 'naval'
      ? 'Land forces cannot attack a naval target.'
      : 'Naval forces cannot attack a land target.' };
  }
  if (artilleryOnly) {
  if (required.some((id) => !command.confirmedWarCountryIds?.includes(id))) {
    return { ok: false, reason: 'War declaration required.', requiredWarCountryIds: required };
  }

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
