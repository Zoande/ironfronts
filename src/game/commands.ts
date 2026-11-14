import { startArmyUpgrade } from './units/upgrades';
/** Authoritative gameplay command boundary and ownership gate. */

import { validateRally } from './commands/rally';
import type { QueuedArmyOrder } from './units/army';
import type { SimContext } from './sim-context';
import { issueMoveOrder, issueStop } from './units/movement';
import { issueManualRetreat } from './combat';
import { issueExtract } from './extraction';
import { queueUnit } from './production';
import { queueBuilding } from './construction';
import { issueAttack } from './commands/attack';
import { issueSplit } from './commands/split';
import { issueStrike } from './strike';
import { startResearch } from './technology';
import {
  declareWar, endAlliance, proposeDiplomacy, respondDiplomacy, sendDiplomaticMessage,
} from './diplomacy';
import { marketTrade, proposeResourceTrade, respondResourceTrade } from './trade';
import type { CommandResult, GameCommand } from './commands/types';

export type {
  AttackCommand, AttackTarget, BuildCommand, CommandResult, ExtractCommand,
  GameCommand, GameCommandType, MoveArmyCommand, ProduceCommand, RallyCommand,
  RetreatArmyCommand, SplitArmyCommand, StopArmyCommand, RenameArmyCommand, SetStanceCommand, DeclareWarCommand,
  EndAllianceCommand, ProposeDiplomacyCommand, RespondDiplomacyCommand,
  SendDiplomaticMessageCommand, StrikeCommand, ResearchCommand,
  MarketTradeCommand, ProposeResourceTradeCommand, RespondResourceTradeCommand,
} from './commands/types';

function controlsArmy(ctx: SimContext, countryId: number, armyId: string): boolean {
  return ctx.state.armies[armyId]?.ownerCountryId === countryId;
}

function queuedCommand(armyId: string, countryId: number, order: QueuedArmyOrder): GameCommand {
  if (order.kind === 'move') return { type: 'moveArmy', armyId, countryId, x: order.x, z: order.z };
  return { type: 'attackArmy', armyId, countryId, target: order.kind === 'attackArmy'
    ? { kind: 'army', armyId: order.targetArmyId }
    : { kind: 'province', provinceId: order.provinceId, x: order.x, z: order.z } };
}

/** Dispatch through the same rules after arrival, without a browser driving the queue. */
export function advanceQueuedArmyOrders(ctx: SimContext): void {
  for (const army of Object.values(ctx.state.armies)) {
    if (army.upgrade || (army.status !== 'idle' && !(army.status === 'atSea' && !army.transport)) || army.order || army.battleFrontIds?.length || !army.queuedOrders?.length) continue;
    const next = army.queuedOrders.shift()!;
    const result = applyImmediateCommand(ctx, queuedCommand(army.id, army.ownerCountryId, next));
    if (!result.ok) {
      army.queuedOrders = [];
      army.queuedOrderError = result.reason ?? 'Queued order could not be executed.';
    }
  }
}

export function applyCommand(ctx: SimContext, command: GameCommand): CommandResult {
  if ('armyId' in command && !controlsArmy(ctx, command.countryId, command.armyId)) {
    return { ok: false, reason: 'Not your army.' };
  }
  if ('armyId' in command && ctx.state.armies[command.armyId]?.upgrade
    && !['renameArmy', 'setStance'].includes(command.type)) return { ok: false, reason: 'This army cannot receive orders until its upgrade completes.' };
  if ((command.type === 'moveArmy' || command.type === 'attackArmy') && command.enqueue) {
    const army = ctx.state.armies[command.armyId];
    if ((army.queuedOrders?.length ?? 0) >= 32) return { ok: false, reason: 'Order queue is full (32 orders).' };
    let order: QueuedArmyOrder;
    if (command.type === 'moveArmy') order = { kind: 'move', x: command.x, z: command.z };
    else if (command.target.kind === 'army') {
      if (!ctx.state.armies[command.target.armyId]) return { ok: false, reason: 'Target army no longer exists.' };
      order = { kind: 'attackArmy', targetArmyId: command.target.armyId };
    } else {
      const provinceId = command.target.provinceId;
      const province = ctx.world.provinces.find(p => p.id === provinceId);
      if (!province) return { ok: false, reason: 'Unknown province.' };
      order = { kind: 'attackProvince', provinceId: province.id,
        x: command.target.x ?? province.center[0], z: command.target.z ?? province.center[1] };
    }
    if ('x' in order && (!Number.isFinite(order.x) || !Number.isFinite(order.z)
      || order.x < 0 || order.x > ctx.world.width || order.z < 0 || order.z > ctx.world.height)) {
      return { ok: false, reason: 'Target is outside the world.' };
    }
    if ((army.status === 'idle' || army.status === 'extracting' || (army.status === 'atSea' && !army.transport)) && !army.order && !army.queuedOrders?.length) {
      const result = applyImmediateCommand(ctx, { ...command, enqueue: false });
      if (result.ok) army.queuedOrderError = null;
      return result;
    }
    (army.queuedOrders ??= []).push(order);
    army.queuedOrderError = null;
    return { ok: true };
  }
  const result = applyImmediateCommand(ctx, command);
  if (result.ok && 'armyId' in command
    && ['moveArmy','attackArmy','stopArmy','retreatArmy','splitArmy','extract'].includes(command.type)) {
    const army = ctx.state.armies[command.armyId];
    if (army) { army.queuedOrders = []; army.queuedOrderError = null; }
  }
  return result;
}

function applyImmediateCommand(ctx: SimContext, command: GameCommand): CommandResult {
  if ('armyId' in command && !controlsArmy(ctx, command.countryId, command.armyId)) {
    return { ok: false, reason: 'Not your army.' };
  }
  switch (command.type) {
    case 'upgradeArmy':
      return startArmyUpgrade(ctx, ctx.state.armies[command.armyId], command.quoteKey);
    case 'moveArmy':
      return issueMoveOrder(
        ctx, command.armyId, command.x, command.z, 'move',
        { kind: 'position', x: command.x, z: command.z }, command.confirmedWarCountryIds,
        [ctx.state.provinceOwners[ctx.world.provinceAt(command.x, command.z)] ?? 0],
      );
    case 'attackArmy':
      return issueAttack(ctx, command);
    case 'retreatArmy':
      return issueManualRetreat(ctx, command.armyId, command.x, command.z);
    case 'splitArmy':
      return issueSplit(ctx, command);
    case 'stopArmy':
      return issueStop(ctx, command.armyId)
        ? { ok: true } : { ok: false, reason: 'Army cannot stop now.' };
    case 'renameArmy': {
      const name = command.name.trim();
      if (!name || name.length > 24) return { ok: false, reason: 'Army names must be 1 to 24 characters.' };
      ctx.state.armies[command.armyId]!.name = name;
      return { ok: true };
    }
    case 'setStance':
      ctx.state.armies[command.armyId]!.stance = command.stance;
      return { ok: true };
    case 'extract':
      return issueExtract(ctx, command.armyId, command.resource);
    case 'produce':
      if (ctx.state.provinceOwners[command.provinceId] !== command.countryId) {
        return { ok: false, reason: 'Not your province.' };
      }
      return queueUnit(ctx, command.provinceId, command.unitTypeId, command.countryId);
    case 'build':
      if (ctx.state.provinceOwners[command.provinceId] !== command.countryId) {
        return { ok: false, reason: 'Not your province.' };
      }
      return queueBuilding(ctx, command.provinceId, command.buildingId, command.countryId);
    case 'research':
      return startResearch(ctx.state.countries[command.countryId], command.branch);
    case 'setRally': {
      if (ctx.state.provinceOwners[command.provinceId] !== command.countryId) {
        return { ok: false, reason: 'Not your province.' };
      }
      if (command.target) {
        // Reject a rally the produced unit could never march to — otherwise it
        // spawns and silently ignores the order. Same reachability test the
        // spawn uses: the province's node and the rally node must share a
        // road-graph component.
        const result = validateRally(ctx, command.countryId, command.provinceId, command.target);
        if (!result.ok) return result;
      }
      if (command.target) ctx.state.rallyPoints[command.provinceId] = { ...command.target };
      else delete ctx.state.rallyPoints[command.provinceId];
      return { ok: true };
    }
    case 'sendDiplomaticMessage':
      return sendDiplomaticMessage(ctx.state, command.countryId, command.targetCountryId, command.body);
    case 'proposeDiplomacy':
      return proposeDiplomacy(ctx.state, command.countryId, command.targetCountryId, command.proposal);
    case 'respondDiplomacy':
      return respondDiplomacy(ctx.state, command.countryId, command.proposalId, command.accept);
    case 'declareWar':
      return declareWar(ctx.state, command.countryId, command.targetCountryId);
    case 'endAlliance':
      return endAlliance(ctx.state, command.countryId, command.targetCountryId);
    case 'strike':
      return issueStrike(ctx, command);
    case 'marketTrade':
      return marketTrade(ctx.state, command.countryId, command.action, command.resource, command.amount);
    case 'proposeResourceTrade':
      return proposeResourceTrade(ctx.state, command.countryId, command.targetCountryId, command.offer, command.request);
    case 'respondResourceTrade':
      return respondResourceTrade(ctx.state, command.countryId, command.proposalId, command.accept);
  }
}
