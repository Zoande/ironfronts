/**
 * `GameSession` — the authoritative owner of gameplay state.
 *
 * The renderer and HUD read a projection of `session.state` and cache a
 * GPU / DOM representation; they never mutate it and are never the source of
 * truth. `main.ts` drives `tick(dtHours)` from a fixed-step accumulator at a
 * lower rate than the render frame.
 *
 * Phase A implements the clock and the passive economy. Movement, extraction,
 * production, combat and capture are added by later phases as additional
 * `tick` systems; their hooks are marked below.
 */

import { parseGameState } from './state-schema';
import { validateWorldState } from './state-invariants';
import { MAX_SIMULATION_STEP_HOURS } from './time';
import { GAME_PACE } from './pacing';
import type { GameOutcome, GameState, PhysicalResource } from './game-state';
import { cloneGameState, relationOf, serializeGameState, setRelation } from './game-state';
import type { LandGraph } from './movement/graph';
import type { ScenarioSelection } from './scenario';
import { scenarioById } from './scenario-catalog';
import { initGameState, type InitResult } from './scenario-init';
import type { WorldData } from './world-data';
import { applyIncome, recomputeIncome } from './economy';
import { stepMovement } from './units/movement';
import { stepExtraction } from './extraction';
import { stepProduction, type UnitCompletion } from './production';
import { stepConstruction, type BuildingCompletion } from './construction';
import { stepCombat, stepCapture, type CaptureEvent, type CombatEvent } from './combat';
import { stepEntrenchment } from './combat/entrenchment';
import { regenOrganization } from './combat/organization';
import { stepSupply } from './combat/supply';
import { stepPhaseProgression } from './phase';
import { stepWarheads } from './strike';
import { stepTechnology } from './technology';
import { stepVictory } from './victory';
import { stepAi } from './ai/simple-ai';
import { applyCommand as runCommand, type CommandResult, type GameCommand } from './commands';
import { wrappedDistance } from './geometry';

/** Longest game-time step a single `tick` will integrate; larger dt is accumulated
 *  so a stall can't teleport armies through provinces. */
const MAX_TICK_HOURS = MAX_SIMULATION_STEP_HOURS;
/** Income is recomputed on this game-hour cadence, not every tick. */
const INCOME_RECOMPUTE_INTERVAL = GAME_PACE.clock.incomeRefreshHours;
/** AI re-plans on this game-hour cadence (cheap, not per tick). */
const AI_INTERVAL = GAME_PACE.clock.aiPlanningHours;
/** Supply reach is recomputed on this game-hour cadence — a straight-line
 *  distance scan per army, cheap but no reason to pay it every tick. */
const SUPPLY_INTERVAL = GAME_PACE.clock.supplyRefreshHours;

export class GameSession {
  readonly state: GameState;
  readonly graph: LandGraph;
  readonly world: WorldData;
  readonly diagnostics: InitResult['diagnostics'];

  /** Drained by `main.ts` each frame for HUD notifications. */
  readonly pendingCompletions: UnitCompletion[] = [];
  readonly pendingBuildings: BuildingCompletion[] = [];
  readonly pendingCaptures: CaptureEvent[] = [];
  readonly pendingCombat: CombatEvent[] = [];
  /** Populated on the single tick the campaign is decided. */
  readonly pendingOutcome: GameOutcome[] = [];

  private constructor(init: InitResult, world: WorldData) {
    this.state = init.state;
    this.graph = init.graph;
    this.world = world;
    this.diagnostics = init.diagnostics;
    recomputeIncome(this.state, this.world, this.graph);
  }

  static create(selection: ScenarioSelection, world: WorldData): GameSession {
    const scenario = scenarioById(selection.scenarioId);
    return new GameSession(initGameState(selection, scenario, world), world);
  }

  /** Restore a validated plain-data snapshot while rebuilding world-derived graph caches. */
  static restore(state: GameState, world: WorldData): GameSession {
    const restored = parseGameState(state);
    const scenario = scenarioById(restored.scenarioId);
    const scaffold = initGameState({
      scenarioId: restored.scenarioId,
      theater: 'global',
      startDate: restored.clock.startDate,
      playerCountryId: 0,
      sandbox: restored.mode === 'sandbox',
    }, scenario, world);
    const session = new GameSession({ ...scaffold, state: restored }, world);
    validateWorldState(session);
    return session;
  }

  get gameTimeHours(): number {
    return this.state.clock.gameTimeHours;
  }

  /** Recompute economy immediately after an authorized developer mutation. */
  refreshDerivedState(): void {
    recomputeIncome(this.state, this.world, this.graph);
    stepSupply(this);
  }

  /** Advance the simulation by `dtHours` of game time. Safe to call with
   *  a large dt (e.g. after a stall) — it is accumulated and sub-stepped. */
  tick(dtHours: number): void {
    if (!Number.isFinite(dtHours)) throw new Error('Simulation duration must be finite.');
    if (!(dtHours > 0)) return;
    this.state.clock.pendingHours = (this.state.clock.pendingHours ?? 0) + dtHours;
    while ((this.state.clock.pendingHours ?? 0) > 1e-12) {
      if (this.state.outcome) { this.state.clock.pendingHours = 0; break; }
      const stepHours = Math.min(MAX_TICK_HOURS, this.state.clock.pendingHours ?? 0);
      this.step(stepHours);
      this.state.clock.pendingHours = Math.max(0, (this.state.clock.pendingHours ?? 0) - stepHours);
    }
  }

  private step(dtHours: number): void {
    this.state.simulationTick += 1;
    this.state.clock.gameTimeHours += dtHours;

    // Campaign already decided — freeze the simulation, keep serving state.
    if (this.state.outcome) return;

    const cadence = this.state.clock.cadence ??= { incomeHours: 0, supplyHours: 0, aiHours: 0 };
    cadence.incomeHours += dtHours;
    cadence.supplyHours += dtHours;
    cadence.aiHours += dtHours;

    // --- economy -------------------------------------------------
    if (this.state.economyEnabled) {
      if (cadence.incomeHours + 1e-12 >= INCOME_RECOMPUTE_INTERVAL) {
        cadence.incomeHours %= INCOME_RECOMPUTE_INTERVAL;
        recomputeIncome(this.state, this.world, this.graph);
        stepPhaseProgression(this);
      }
      applyIncome(this.state, dtHours);
    }

    // --- gameplay systems, fixed order ------------------------------
    stepMovement(this, dtHours);
    if (cadence.supplyHours + 1e-12 >= SUPPLY_INTERVAL) {
      cadence.supplyHours %= SUPPLY_INTERVAL;
      stepSupply(this);
    }
    stepEntrenchment(this, dtHours);
    regenOrganization(this, dtHours);
    stepExtraction(this, dtHours);
    for (const b of stepConstruction(this, dtHours)) this.pendingBuildings.push(b);
    stepWarheads(this, dtHours);
    stepTechnology(this.state.countries, dtHours);
    for (const done of stepProduction(this, dtHours)) this.pendingCompletions.push(done);
    for (const ev of stepCombat(this, dtHours)) this.pendingCombat.push(ev);
    for (const cap of stepCapture(this)) this.pendingCaptures.push(cap);
    const outcome = stepVictory(this);
    if (outcome) this.pendingOutcome.push(outcome);

    // --- simple defensive AI (slow cadence) -----------------------
    if (cadence.aiHours + 1e-12 >= AI_INTERVAL) {
      const elapsedAiHours = cadence.aiHours;
      cadence.aiHours %= AI_INTERVAL;
      stepAi(this, elapsedAiHours);
    }
  }

  /** Only the player's own entities accept commands. */
  ownsArmy(countryId: number, armyId: string): boolean {
    return this.state.armies[armyId]?.ownerCountryId === countryId;
  }

  ownsProvince(countryId: number, provinceId: number): boolean {
    return this.state.provinceOwners[provinceId] === countryId;
  }

  /**
   * Player-facing summary of a province, fog-aware. Deposit detail is
   * withheld for provinces the player does not own while fog of war is active.
   */
  describeProvince(viewerCountryId: number, provinceId: number): {
    ownerId: number;
    ownerName: string;
    ownerColor: string;
    isOwn: boolean;
    resources: { stone: number; metal: number; oil: number } | null;
    controlled: boolean;
    extracting: boolean;
  } {
    const ownerId = this.state.provinceOwners[provinceId] ?? 0;
    const owner = this.state.countries[ownerId];
    const isOwn = ownerId === viewerCountryId;
    const fullDetail = isOwn || !this.state.fogOfWar;

    // Deposits shown here must match what the map overlay shows: own/sandbox
    // reveal everything in the province; otherwise only deposits the player can
    // actually see (inside friendly vision) count — so the tooltip never
    // contradicts a deposit chip the player is looking at.
    let resources: { stone: number; metal: number; oil: number } | null = null;
    let controlled = false;
    let extracting = false;
    const economy = this.state.provinceEconomies?.[provinceId];
    if (economy && fullDetail) {
      resources = { stone: economy.baseProduction.stone, metal: economy.baseProduction.metal, oil: economy.baseProduction.oil };
      controlled = isOwn;
      extracting = Object.values(this.state.armies).some((army) => army.extractionAssignment?.provinceId === provinceId);
    }

    return {
      ownerId,
      ownerName: owner?.name ?? `Country ${ownerId}`,
      ownerColor: owner?.color ?? '#888888',
      isOwn,
      resources,
      controlled,
      extracting,
    };
  }

  isAtWar(a: number, b: number): boolean {
    return relationOf(this.state, a, b) === 'war';
  }

  /** Entering or capturing foreign land forces war if not already. */
  declareWar(a: number, b: number): void {
    setRelation(this.state, a, b, 'war');
  }

  // ---- command boundary --------------------------------------------
  // Every mutation goes through `applyCommand`, which validates the acting
  // country against authoritative ownership. The AI issues the same commands;
  // a future server receives them. The `order*` / `produce` helpers below just
  // stamp the player's countryId onto a command for the HUD's convenience.

  applyCommand(command: GameCommand): CommandResult {
    const result = runCommand(this, command);
    // A strategic strike lands outside the tick loop, so raise its presentation
    // event here — the one place that sees both the result and the feed.
    if (result.strike) {
      this.pendingCombat.push({
        kind: 'strike',
        attacker: result.strike.attacker,
        defender: result.strike.defender,
        provinceId: result.strike.provinceId,
        x: result.strike.x,
        z: result.strike.z,
      });
    }
    return result;
  }

  orderMove(countryId: number, armyId: string, x: number, z: number, intent: 'move' | 'attack' = 'move') {
    if (intent === 'attack') {
      const provinceId = this.world.provinceAt(x, z);
      if (provinceId < 0) return { ok: false, reason: 'No province at that location.' };
      return this.applyCommand({
        type: 'attackArmy', countryId, armyId, target: { kind: 'province', provinceId, x, z },
      });
    }
    return this.applyCommand({ type: 'moveArmy', countryId, armyId, x, z });
  }

  orderStop(countryId: number, armyId: string): boolean {
    return this.applyCommand({
      type: 'stopArmy', countryId, armyId,
    }).ok;
  }

  orderExtract(countryId: number, armyId: string, resource: PhysicalResource = 'food') {
    return this.applyCommand({
      type: 'extract', countryId, armyId, resource,
    });
  }

  produce(countryId: number, provinceId: number, unitTypeId: string) {
    return this.applyCommand({
      type: 'produce', countryId, provinceId, unitTypeId,
    });
  }

  build(countryId: number, provinceId: number, buildingId: import('./units/unit-types').BuildingId) {
    return this.applyCommand({
      type: 'build', countryId, provinceId, buildingId,
    });
  }

  setRally(countryId: number, provinceId: number, x: number, z: number) {
    return this.applyCommand({
      type: 'setRally', countryId, provinceId, target: { x, z },
    });
  }

  clearRally(countryId: number, provinceId: number) {
    return this.applyCommand({
      type: 'setRally', countryId, provinceId, target: null,
    });
  }

  rallyPoint(provinceId: number): { x: number; z: number } | null {
    return this.state.rallyPoints[provinceId] ?? null;
  }

  /** Flip the foreign country geographically nearest the player's capital to
   *  'ai' control, so the slice has one active opponent. Returns its id. */
  enableNearbyAi(originCountryId: number): number | null {
    const player = this.state.countries[originCountryId];
    if (!player) return null;
    const capitalId = this.world.countries.find((c) => c.id === originCountryId)
      ?.capitalProvinceId ?? -1;
    const capital = this.world.provinces.find((p) => p.id === capitalId)
      ?? this.world.provinces.find((p) => this.state.provinceOwners[p.id] === player.id);
    if (!capital) return null;

    let best: number | null = null;
    let bestDist = Infinity;
    for (const country of Object.values(this.state.countries)) {
      if (country.id === player.id || country.controller === 'player') continue;
      const home = this.world.provinces.find((p) => this.state.provinceOwners[p.id] === country.id);
      if (!home) continue;
      const d = wrappedDistance(
        capital.center[0], capital.center[1], home.center[0], home.center[1], this.world.width,
      );
      if (d < bestDist) { bestDist = d; best = country.id; }
    }
    if (best !== null) {
      this.state.countries[best].controller = 'ai';
      // The AI opponent now needs an economy too — give it the same strategic
      // baseline the player got at init (idempotent if its natural geography
      // already covers stone + metal).
    }
    return best;
  }

  claimCountry(countryId: number): boolean {
    const country = this.state.countries[countryId];
    if (!country) return false;
    country.controller = 'player';
    return true;
  }

  serialize(): string {
    return serializeGameState(this.state);
  }

  /** Deep structural clone of the current state (proves serializability). */
  snapshot(): GameState {
    return cloneGameState(this.state);
  }
}
