import type { BuildingId } from '../units/unit-types';
import type { ArmyStance } from '../units/army';
import type { PhysicalResource } from '../game-state';
import type { TechnologyBranch } from '../game-state';

export interface MoveArmyCommand {
  readonly type: 'moveArmy';
  readonly countryId: number;
  readonly armyId: string;
  readonly x: number;
  readonly z: number;
  readonly confirmedWarCountryIds?: readonly number[];
}

export type AttackTarget =
  | { readonly kind: 'province'; readonly provinceId: number; readonly x?: number; readonly z?: number }
  | { readonly kind: 'army'; readonly armyId: string };

export interface AttackCommand {
  readonly type: 'attackArmy';
  readonly countryId: number;
  readonly armyId: string;
  readonly target: AttackTarget;
  readonly confirmedWarCountryIds?: readonly number[];
}

export interface RetreatArmyCommand {
  readonly type: 'retreatArmy';
  readonly countryId: number;
  readonly armyId: string;
  readonly x: number;
  readonly z: number;
}

export interface SplitArmyCommand {
  readonly type: 'splitArmy';
  readonly countryId: number;
  readonly armyId: string;
  readonly groups: readonly { readonly typeId: string; readonly count: number }[];
  readonly x: number;
  readonly z: number;
  readonly confirmedWarCountryIds?: readonly number[];
}

export interface StopArmyCommand {
  readonly type: 'stopArmy';
  readonly countryId: number;
  readonly armyId: string;
}

export interface SetStanceCommand {
  readonly type: 'setStance';
  readonly countryId: number;
  readonly armyId: string;
  readonly stance: ArmyStance;
}

export interface ExtractCommand {
  readonly type: 'extract';
  readonly countryId: number;
  readonly armyId: string;
  readonly resource: PhysicalResource;
}

export interface ProduceCommand {
  readonly type: 'produce';
  readonly countryId: number;
  readonly provinceId: number;
  readonly unitTypeId: string;
}

export interface BuildCommand {
  readonly type: 'build';
  readonly countryId: number;
  readonly provinceId: number;
  readonly buildingId: BuildingId;
}

export interface ResearchCommand {
  readonly type: 'research';
  readonly countryId: number;
  readonly branch: TechnologyBranch;
}

export interface RallyCommand {
  readonly type: 'setRally';
  readonly countryId: number;
  readonly provinceId: number;
  readonly target: { readonly x: number; readonly z: number } | null;
}

export interface SendDiplomaticMessageCommand {
  readonly type: 'sendDiplomaticMessage';
  readonly countryId: number;
  readonly targetCountryId: number;
  readonly body: string;
}

export interface ProposeDiplomacyCommand {
  readonly type: 'proposeDiplomacy';
  readonly countryId: number;
  readonly targetCountryId: number;
  readonly proposal: 'alliance' | 'peace';
}

export interface RespondDiplomacyCommand {
  readonly type: 'respondDiplomacy';
  readonly countryId: number;
  readonly proposalId: string;
  readonly accept: boolean;
}

export interface DeclareWarCommand {
  readonly type: 'declareWar';
  readonly countryId: number;
  readonly targetCountryId: number;
}

export interface EndAllianceCommand {
  readonly type: 'endAlliance';
  readonly countryId: number;
  readonly targetCountryId: number;
}

export type GameCommand =
  | MoveArmyCommand | AttackCommand | RetreatArmyCommand | SplitArmyCommand
  | StopArmyCommand | SetStanceCommand | ExtractCommand | ProduceCommand | BuildCommand | ResearchCommand | RallyCommand
  | SendDiplomaticMessageCommand | ProposeDiplomacyCommand | RespondDiplomacyCommand
  | DeclareWarCommand | EndAllianceCommand | StrikeCommand;

export type GameCommandType = GameCommand['type'];

export interface StrikeCommand {
  readonly type: 'strike';
  readonly countryId: number;
  readonly provinceId: number;
  readonly x: number;
  readonly z: number;
}

export interface CommandResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly orderId?: string;
  readonly armyId?: string;
  readonly nodes?: number;
  readonly requiredWarCountryIds?: readonly number[];
  /** Set by a successful `strike` so `GameSession` can raise the combat event. */
  readonly strike?: {
    readonly attacker: number;
    readonly defender: number;
    readonly provinceId: number;
    readonly x: number;
    readonly z: number;
  };
}
