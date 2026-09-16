import {
  GameSession, UNIT_TYPES, BUILDINGS, nearestNode, unitType,
  setWeatherMode, updateRealWeather,
  type GameCommand, type GameState, type WorldData,
} from '@ironfronts/game-core';
import {
  GAME_ID, GAME_VERSION, PROTOCOL_VERSION,
  type CommandPayload, type GameLobby, type PlayerProjection, type PresentationCatalogs,
} from '@ironfronts/protocol';
import { projectFor } from './projection';
import { SIMULATION_INTERVAL_MS, SIMULATION_TICK_HOURS } from './timing';

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
        if (!accountId || this.seatsByAccount.has(accountId) || !this.session.state.countries[countryId] || this.accountsByCountry.has(countryId)) {
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
    const aliveCountryIds = new Set(Object.values(this.session.state.provinceOwners));
    return {
      gameId: GAME_ID,
      name: 'World at War',
      gameVersion: GAME_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      assignedCountryId: accountId ? this.seatsByAccount.get(accountId) ?? null : null,
      // The lobby map shows every territorial country. `join` still enforces
      // the scenario's five-city eligibility list authoritatively.
      countries: Object.values(this.session.state.countries)
        .filter((country) => aliveCountryIds.has(country.id))
        .sort((a, b) => a.id - b.id)
        .map((country) => ({
          id: country.id,
          name: country.name,
          color: country.color,
          startingCities: cityCounts.get(country.id) ?? 0,
          alive: true,
          claimed: this.accountsByCountry.has(country.id),
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
  projection(countryId: number, simulationSpeedMultiplier = 1, debugPotential = false): PlayerProjection {
    const gameHoursPerRealSecond = SIMULATION_TICK_HOURS * 1_000 / SIMULATION_INTERVAL_MS
      * simulationSpeedMultiplier;
    return projectFor(this.session.state, this.world, this.session.graph, countryId,
      gameHoursPerRealSecond, Date.now(), debugPotential);
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
    if (payload.type === 'strike'
      && (payload.x < 0 || payload.x > this.world.width
        || payload.z < 0 || payload.z > this.world.height)) {
      return { ok: false, reason: 'Target is outside the world.' };
    }
    const command = { ...payload, countryId } as GameCommand;
    return this.session.applyCommand(command);
  }

  updateWeather(nowEpochMs = Date.now()): boolean {
    return updateRealWeather(this.session.state, nowEpochMs);
  }

  setWeatherMode(mode: 'automatic' | 'forced-clear' | 'forced-rain', nowEpochMs = Date.now()): void {
    setWeatherMode(this.session.state, mode, nowEpochMs);
  }

  cheatBuild(provinceId: number, buildingId: keyof typeof BUILDINGS, level: number): { ok: boolean; message: string } {
    const province = this.world.provinces.find((entry) => entry.id === provinceId);
    if (!province) return { ok: false, message: `Province ${provinceId} does not exist.` };
    const definition = BUILDINGS[buildingId];
    if (!definition || !Number.isInteger(level) || level < 1 || level > 8) {
      return { ok: false, message: 'Invalid building or level.' };
    }
    if (definition.kind === 'military') {
      const buildings = this.session.state.provinceBuildings[provinceId] ??= {
        barracks: 0, tankPlant: 0, ordnance: 0, missileSite: 0,
      };
      buildings[buildingId as 'barracks'] = Math.max(buildings[buildingId as 'barracks'], level);
    } else {
      const economy = this.session.state.provinceEconomies?.[provinceId];
      if (!economy) return { ok: false, message: `Province ${provinceId} has no economy record.` };
      economy.resourceBuildings[buildingId as 'fields'] = Math.max(
        economy.resourceBuildings[buildingId as 'fields'], level,
      );
    }
    const queue = this.session.state.constructionQueues[provinceId];
    if (queue) this.session.state.constructionQueues[provinceId] = queue.filter(
      (order) => order.buildingId !== buildingId || (order.targetTier ?? 1) > level,
    );
    this.session.refreshDerivedState();
    return { ok: true, message: `${definition.label} Level ${level} completed in province ${provinceId}.` };
  }

  cheatSpawnUnit(provinceId: number, countryId: number, unitTypeId: string): { ok: boolean; message: string } {
    const province = this.world.provinces.find((entry) => entry.id === provinceId);
    const country = this.session.state.countries[countryId];
    const definition = UNIT_TYPES.find((entry) => entry.id === unitTypeId);
    if (!province) return { ok: false, message: `Province ${provinceId} does not exist.` };
    if (!country) return { ok: false, message: `Country ${countryId} does not exist.` };
    if (!definition) return { ok: false, message: `Unit ${unitTypeId} does not exist.` };
    const nodeId = nearestNode(this.session.graph, province.center[0], province.center[1]);
    if (nodeId < 0) return { ok: false, message: `Province ${provinceId} has no reachable road node.` };
    const id = `army-${this.session.state.nextArmyId++}`;
    this.session.state.armies[id] = {
      id, ownerCountryId: countryId, name: `${definition.name} ${id}`,
      x: this.session.graph.nodeX[nodeId], z: this.session.graph.nodeZ[nodeId], graphNodeId: nodeId,
      edge: null, units: [{ typeId: unitTypeId, count: 1, hp: unitType(unitTypeId).maxHp, experience: 0 }],
      status: 'idle', order: null, extractingNodeId: null, extractionAssignment: null,
      shortageSeverity: { funds: 0, food: 0, metal: 0, oil: 0 }, lastGraphNodeId: null,
      suspendedOrder: null, battleFrontIds: [], retreat: null,
      artillery: { targetArmyId: null, manualTarget: false }, navalCrossing: null,
      organization: 100, entrenchment: 0, stance: 'attack-defend', inSupply: true,
    };
    this.session.refreshDerivedState();
    return { ok: true, message: `${definition.name} spawned for country ${countryId} in province ${provinceId}.` };
  }

  cheatGiveResource(countryId: number, resource: keyof GameState['countries'][number]['stockpile'], amount: number): { ok: boolean; message: string } {
    const country = this.session.state.countries[countryId];
    if (!country) return { ok: false, message: `Country ${countryId} does not exist.` };
    if (!Number.isFinite(amount) || amount <= 0) return { ok: false, message: 'Amount must be positive.' };
    country.stockpile[resource] += amount;
    return { ok: true, message: `Added ${amount.toLocaleString()} ${resource} to ${country.name} (${countryId}).` };
  }
}

export interface GameRuntimeSnapshot {
  version: 2;
  state: GameState;
  seats: Array<[accountId: string, countryId: number]>;
}
