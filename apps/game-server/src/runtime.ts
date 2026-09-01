import { GameSession, UNIT_TYPES, BUILDINGS, type GameCommand, type GameState, type WorldData } from '@ironfronts/game-core';
import {
  GAME_ID, GAME_VERSION, PROTOCOL_VERSION,
  type CommandPayload, type GameLobby, type PlayerProjection, type PresentationCatalogs,
} from '@ironfronts/protocol';
import { projectFor } from './projection';

export class GameRuntime {
  readonly session: GameSession;
  readonly seatsByAccount = new Map<string, number>();
  readonly accountsByCountry = new Map<number, string>();
  readonly catalogs: PresentationCatalogs = {
    units: UNIT_TYPES.map((unit) => ({ ...unit })),
    buildings: Object.entries(BUILDINGS).map(([id, building]) => ({ id, ...building })),
  };

  constructor(readonly world: WorldData, snapshot?: GameRuntimeSnapshot) {
    this.session = snapshot
      ? GameSession.restore(snapshot.state, world)
      : GameSession.create({
        scenarioId: 'OP-1939-01', theater: 'global', startDate: '1 Sep 1939',
        playerCountryId: 0, sandbox: false,
      }, world);
    if (snapshot) {
      for (const [accountId, countryId] of snapshot.seats) {
        if (!accountId || !this.session.state.countries[countryId] || this.accountsByCountry.has(countryId)) {
          throw new Error('Persisted country assignments are invalid.');
        }
        this.seatsByAccount.set(accountId, countryId);
        this.accountsByCountry.set(countryId, accountId);
      }
    }
  }

  tick(hours: number): void { this.session.tick(hours); }

  lobby(accountId?: string): GameLobby {
    const cityCounts = new Map<number, number>();
    for (const province of this.world.provinces) {
      if (!province.urban) continue;
      const owner = this.session.state.provinceOwners[province.id];
      cityCounts.set(owner, (cityCounts.get(owner) ?? 0) + 1);
    }
    return {
      gameId: GAME_ID,
      name: 'World at War',
      gameVersion: GAME_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      assignedCountryId: accountId ? this.seatsByAccount.get(accountId) ?? null : null,
      countries: this.session.diagnostics.eligibleCountryIds.map((id) => ({
        id,
        name: this.session.state.countries[id]?.name ?? `Country ${id}`,
        color: this.session.state.countries[id]?.color ?? '#888888',
        startingCities: cityCounts.get(id) ?? 0,
        alive: Object.values(this.session.state.provinceOwners).some((owner) => owner === id),
        claimed: this.accountsByCountry.has(id),
      })),
    };
  }

  join(accountId: string, countryId: number): { ok: true; countryId: number } | { ok: false; reason: string } {
    const existing = this.seatsByAccount.get(accountId);
    if (existing !== undefined) return existing === countryId
      ? { ok: true, countryId: existing }
      : { ok: false, reason: 'This account is already permanently assigned.' };
    if (!this.session.diagnostics.eligibleCountryIds.includes(countryId)) {
      return { ok: false, reason: 'Country is not eligible for play.' };
    }
    if (!Object.values(this.session.state.provinceOwners).some((owner) => owner === countryId)) {
      return { ok: false, reason: 'Country no longer owns territory.' };
    }
    if (this.accountsByCountry.has(countryId)) return { ok: false, reason: 'Country is already claimed.' };
    this.seatsByAccount.set(accountId, countryId);
    this.accountsByCountry.set(countryId, accountId);
    this.session.claimCountry(countryId);
    return { ok: true, countryId };
  }

  seat(accountId: string): number | null { return this.seatsByAccount.get(accountId) ?? null; }
  snapshot(): GameRuntimeSnapshot {
    return { version: 2, state: this.session.snapshot(), seats: [...this.seatsByAccount.entries()] };
  }
  projection(countryId: number): PlayerProjection {
    return projectFor(this.session.state, this.world, this.session.graph, countryId);
  }

  command(countryId: number, payload: CommandPayload) {
    if ((payload.type === 'moveArmy' || payload.type === 'splitArmy' || payload.type === 'retreatArmy')
      && (payload.x < 0 || payload.x > this.world.width || payload.z < 0 || payload.z > this.world.height)) {
      return { ok: false, reason: 'Target is outside the world.' };
    }
    if (payload.type === 'attackArmy' && payload.target.kind === 'province'
      && payload.target.x !== undefined && payload.target.z !== undefined
      && (payload.target.x < 0 || payload.target.x > this.world.width
        || payload.target.z < 0 || payload.target.z > this.world.height)) {
      return { ok: false, reason: 'Target is outside the world.' };
    }
    const command = { ...payload, countryId } as GameCommand;
    return this.session.applyCommand(command);
  }
}

export interface GameRuntimeSnapshot {
  version: 2;
  state: GameState;
  seats: Array<[accountId: string, countryId: number]>;
}
