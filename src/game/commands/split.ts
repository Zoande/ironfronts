/** Atomic stack splitting and mid-edge detachment routing. */

import type { SimContext } from '../sim-context';
import {
  canExtract, ensureArmyRuntimeState, stackUnitCount, type ArmyStack, type UnitGroup,
} from '../units/army';
import { issueMoveOrder } from '../units/movement';
import { nearestNode } from '../movement/graph';
import { findPath, pathLength } from '../movement/pathfind';
import { wrappedDistance } from '../geometry';
import type { CommandResult, SplitArmyCommand } from './types';

function requestedGroups(
  parent: ArmyStack, requested: SplitArmyCommand['groups'],
): UnitGroup[] | string {
  const byType = new Map<string, number>();
  for (const item of requested) {
    if (!Number.isInteger(item.count) || item.count < 0) {
      return 'Split counts must be whole numbers.';
    }
    byType.set(item.typeId, (byType.get(item.typeId) ?? 0) + item.count);
  }
  const groups: UnitGroup[] = [];
  for (const [typeId, count] of byType) {
    if (count === 0) continue;
    const source = parent.units.find((group) => group.typeId === typeId);
    if (!source || count > source.count) return 'Split exceeds the available units.';
    groups.push({
      typeId, count, hp: source.hp * count / source.count, experience: source.experience,
    });
  }
  const detached = groups.reduce((sum, group) => sum + group.count, 0);
  if (detached < 1 || detached >= stackUnitCount(parent)) {
    return 'The parent and detachment must each retain at least one unit.';
  }
  return groups;
}

function chooseMidEdgeEndpoint(
  ctx: SimContext, parent: ArmyStack, destinationX: number, destinationZ: number,
): number {
  const originalNodeId = parent.graphNodeId;
  const nextEdgeNodeId = parent.order?.path[0];
  if (nextEdgeNodeId === undefined) return originalNodeId;
  const component = ctx.graph.component[originalNodeId] ?? -1;
  const goal = nearestNode(ctx.graph, destinationX, destinationZ, 600, component);
  const previousPath = goal >= 0 ? findPath(ctx.graph, originalNodeId, goal) : null;
  const nextPath = goal >= 0 ? findPath(ctx.graph, nextEdgeNodeId, goal) : null;
  const previousCost = previousPath
    ? wrappedDistance(
      parent.x, parent.z, ctx.graph.nodeX[originalNodeId], ctx.graph.nodeZ[originalNodeId],
      ctx.world.width,
    ) + pathLength(ctx.graph, previousPath)
    : Infinity;
  const nextCost = nextPath
    ? wrappedDistance(
      parent.x, parent.z, ctx.graph.nodeX[nextEdgeNodeId], ctx.graph.nodeZ[nextEdgeNodeId],
      ctx.world.width,
    ) + pathLength(ctx.graph, nextPath)
    : Infinity;
  return nextCost < previousCost ? nextEdgeNodeId : originalNodeId;
}

export function issueSplit(ctx: SimContext, command: SplitArmyCommand): CommandResult {
  const parent = ctx.state.armies[command.armyId];
  ensureArmyRuntimeState(parent);
  if (parent.status === 'engaged' || parent.status === 'retreating') {
    return { ok: false, reason: 'Cannot split during close combat or retreat.' };
  }
  const groups = requestedGroups(parent, command.groups);
  if (typeof groups === 'string') return { ok: false, reason: groups };
  const id = `army-${ctx.state.nextArmyId}`;
  const routeNodeId = chooseMidEdgeEndpoint(ctx, parent, command.x, command.z);
  const routedFromNextEdge = routeNodeId !== parent.graphNodeId;
  const child: ArmyStack = {
    id,
    ownerCountryId: parent.ownerCountryId,
    name: `${parent.name} Detachment`,
    x: parent.x,
    z: parent.z,
    graphNodeId: routeNodeId,
    lastGraphNodeId: routedFromNextEdge ? parent.graphNodeId : parent.lastGraphNodeId ?? null,
    units: groups,
    status: 'idle',
    order: null,
    extractingNodeId: null,
    suspendedOrder: null,
    battleFrontIds: [],
    retreat: null,
    artillery: { targetArmyId: null, manualTarget: false },
  };
  ctx.state.armies[id] = child;
  const route = issueMoveOrder(
    ctx, id, command.x, command.z, 'move',
    { kind: 'position', x: command.x, z: command.z }, command.confirmedWarCountryIds,
    [ctx.state.provinceOwners[ctx.world.provinceAt(command.x, command.z)] ?? 0],
  );
  if (!route.ok) {
    delete ctx.state.armies[id];
    return route;
  }
  if (routedFromNextEdge && child.order) {
    child.order.path.unshift(child.graphNodeId);
    child.graphNodeId = parent.graphNodeId;
  }

  for (const detached of groups) {
    const source = parent.units.find((group) => group.typeId === detached.typeId)!;
    source.count -= detached.count;
    source.hp -= detached.hp;
  }
  parent.units = parent.units.filter((group) => group.count > 0 && group.hp > 0);
  if (parent.status === 'extracting' && !canExtract(parent)) {
    const node = parent.extractingNodeId === null
      ? undefined : ctx.state.resourceNodes[parent.extractingNodeId];
    if (node?.extractorArmyId === parent.id) {
      node.extractorArmyId = null;
      node.status = node.remaining > 0 ? 'idle' : 'exhausted';
    }
    parent.extractingNodeId = null;
    parent.status = 'idle';
  }
  ctx.state.nextArmyId += 1;
  return { ...route, armyId: id };
}
