/** Authoritative gameplay command boundary and ownership gate. */

import { validateRally } from './commands/rally';
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
import type { CommandResult, GameCommand } from './commands/types';

export type {
  AttackCommand, AttackTarget, BuildCommand, CommandResult, ExtractCommand,
  GameCommand, GameCommandType, MoveArmyCommand, ProduceCommand, RallyCommand,
  RetreatArmyCommand, SplitArmyCommand, StopArmyCommand, SetStanceCommand, DeclareWarCommand,
  EndAllianceCommand, ProposeDiplomacyCommand, RespondDiplomacyCommand,
  SendDiplomaticMessageCommand, StrikeCommand, ResearchCommand,
} from './commands/types';

function controlsArmy(ctx: SimContext, countryId: number, armyId: string): boolean {
  return ctx.state.armies[armyId]?.ownerCountryId === countryId;
}

export function applyCommand(ctx: SimContext, command: GameCommand): CommandResult {
  if ('armyId' in command && !controlsArmy(ctx, command.countryId, command.armyId)) {
    return { ok: false, reason: 'Not your army.' };
  }
  switch (command.type) {
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
  }
}
