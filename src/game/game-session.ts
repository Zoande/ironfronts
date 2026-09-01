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

import type { GameState } from './game-state';
import { cloneGameState, relationOf, serializeGameState, setRelation } from './game-state';
import type { LandGraph } from './movement/graph';
import type { ScenarioSelection } from './scenario';
import { scenarioById } from './scenario-catalog';
import { initGameState, type InitResult } from './scenario-init';
import type { WorldData } from './world-data';
import { applyIncome, recomputeIncome } from './economy';
import { stepMovement } from './units/movement';
import { stepExtraction } from './extraction';
import { producibleUnits, stepProduction, type UnitCompletion } from './production';
import { buildOptions, stepConstruction, type BuildingCompletion } from './construction';
import { stepCombat, stepCapture, type CaptureEvent, type CombatEvent } from './combat';
import { stepAi } from './ai/simple-ai';
import { applyCommand as runCommand, type CommandResult, type GameCommand } from './commands';
import { guaranteeStrategicBaseline } from './resource-bootstrap';
import { visibleResourceNodes } from './player-view';
import { wrappedDistance } from './geometry';

/** Longest game-time step a single `tick` will integrate; larger dt is clamped
 *  so a stall can't teleport armies through provinces. */
const MAX_TICK_HOURS = 1.5;
/** Income is recomputed on this game-hour cadence, not every tick. */
const INCOME_RECOMPUTE_INTERVAL = 1;
/** AI re-plans on this game-hour cadence (cheap, not per tick). */
const AI_INTERVAL = 2;

export class GameSession {
  readonly state: GameState;
  readonly graph: LandGraph;
  readonly world: WorldData;
  readonly diagnostics: InitResult['diagnostics'];

  private incomeClock = 0;
  private aiClock = 0;

  /** Drained by `main.ts` each frame for HUD notifications. */
  readonly pendingCompletions: UnitCompletion[] = [];
  readonly pendingBuildings: BuildingCompletion[] = [];
  readonly pendingCaptures: CaptureEvent[] = [];
  readonly pendingCombat: CombatEvent[] = [];

  private constructor(init: InitResult, world: WorldData) {
    this.state = init.state;
    this.graph = init.graph;
    this.world = world;
    this.diagnostics = init.diagnostics;
    recomputeIncome(this.state, this.world);
  }

  static create(selection: ScenarioSelection, world: WorldData): GameSession {
    const scenario = scenarioById(selection.scenarioId);
    return new GameSession(initGameState(selection, scenario, world), world);
  }

  /** Restore a validated plain-data snapshot while rebuilding world-derived graph caches. */
  static restore(state: GameState, world: WorldData): GameSession {
    const restored = cloneGameState(state);
    const scenario = scenarioById(restored.scenarioId);
    const scaffold = initGameState({
      scenarioId: restored.scenarioId,
      theater: 'global',
      startDate: restored.clock.startDate,
      playerCountryId: 0,
      sandbox: restored.mode === 'sandbox',
    }, scenario, world);
    return new GameSession({ ...scaffold, state: restored }, world);
  }

  get gameTimeHours(): number {
    return this.state.clock.gameTimeHours;
  }

  /** Advance the simulation by `dtHours` of game time. Safe to call with
   *  a large dt (e.g. after a stall) — it is clamped and sub-stepped. */
  tick(dtHours: number): void {
    if (!(dtHours > 0)) return;
    let remaining = dtHours;
    while (remaining > 0) {
      const step = Math.min(remaining, MAX_TICK_HOURS);
      this.step(step);
      remaining -= step;
    }
  }

  private step(dtHours: number): void {
    this.state.simulationTick += 1;
    this.state.clock.gameTimeHours += dtHours;

    // --- economy -------------------------------------------------
    if (this.state.economyEnabled) {
      this.incomeClock += dtHours;
      if (this.incomeClock >= INCOME_RECOMPUTE_INTERVAL) {
        recomputeIncome(this.state, this.world);
        this.incomeClock = 0;
      }
      applyIncome(this.state, dtHours);
    }

    // --- gameplay systems, fixed order ------------------------------
    stepMovement(this, dtHours);
    stepExtraction(this, dtHours);
    for (const b of stepConstruction(this, dtHours)) this.pendingBuildings.push(b);
    for (const done of stepProduction(this, dtHours)) this.pendingCompletions.push(done);
    for (const ev of stepCombat(this, dtHours)) this.pendingCombat.push(ev);
    for (const cap of stepCapture(this)) this.pendingCaptures.push(cap);

    // --- simple defensive AI (slow cadence) -----------------------
    this.aiClock += dtHours;
    if (this.aiClock >= AI_INTERVAL) {
      stepAi(this, this.aiClock);
      this.aiClock = 0;
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
    const visibleIds = fullDetail
      ? null
      : new Set(visibleResourceNodes(this.state, this.world, viewerCountryId).map((n) => n.id));

    let resources: { stone: number; metal: number; oil: number } | null = null;
    let controlled = false;
    let extracting = false;
    {
      const totals = { stone: 0, metal: 0, oil: 0 };
      let any = false;
      for (const node of Object.values(this.state.resourceNodes)) {
        if (node.provinceId !== provinceId) continue;
        if (visibleIds && !visibleIds.has(node.id)) continue;
        any = true;
        totals[node.kind] += node.remaining;
        if (node.controllerCountryId === ownerId) controlled = true;
        if (node.status === 'extracting') extracting = true;
      }
      resources = any ? totals : null;
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
    return runCommand(this, command);
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

  orderExtract(countryId: number, armyId: string) {
    return this.applyCommand({
      type: 'extract', countryId, armyId,
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

  producible(countryId: number, provinceId: number): string[] {
    return producibleUnits(this, provinceId, countryId);
  }

  buildable(countryId: number, provinceId: number) {
    return buildOptions(this, provinceId, countryId);
  }

  /** Resource node whose access point the army is standing on (for the EXTRACT
   *  affordance), or null. */
  extractableNodeAt(armyId: string): number | null {
    const army = this.state.armies[armyId];
    if (!army) return null;
    const node = Object.values(this.state.resourceNodes).find(
      (n) => n.accessNodeId === army.graphNodeId && n.remaining > 0,
    );
    return node ? node.id : null;
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
      guaranteeStrategicBaseline(
        this.state.resourceNodes,
        { world: this.world, graph: this.graph, provinceOwners: this.state.provinceOwners },
        best, this.state.seed,
      );
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
