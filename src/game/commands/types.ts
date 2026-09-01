import type { BuildingId } from '../units/unit-types';

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

export interface ExtractCommand {
  readonly type: 'extract';
  readonly countryId: number;
  readonly armyId: string;
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

export interface RallyCommand {
  readonly type: 'setRally';
  readonly countryId: number;
  readonly provinceId: number;
  readonly target: { readonly x: number; readonly z: number } | null;
}

export type GameCommand =
  | MoveArmyCommand | AttackCommand | RetreatArmyCommand | SplitArmyCommand
  | StopArmyCommand | ExtractCommand | ProduceCommand | BuildCommand | RallyCommand;

export type GameCommandType = GameCommand['type'];

export interface CommandResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly orderId?: string;
  readonly armyId?: string;
  readonly nodes?: number;
  readonly requiredWarCountryIds?: readonly number[];
}
