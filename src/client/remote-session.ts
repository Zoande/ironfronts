import type {
  CommandPayload, PlayerProjection, PresentationCatalogs, ProjectedArmy,
} from '@ironfronts/protocol';
import { GameConnection } from './game-connection';
import type { GameClockReading } from './game-clock';

type BuildingId = 'barracks' | 'tankPlant' | 'ordnance' | 'missileSite' | 'fields' | 'quarry' | 'mine' | 'oilPump';
type PhysicalResource = 'food' | 'stone' | 'metal' | 'oil';
type ArmyStance = 'attack' | 'attack-defend' | 'defend' | 'defend-retreat' | 'retreat';
export type TechnologyBranch = 'infantry' | 'resources' | 'training' | 'hybrid' | 'armored';

interface Stockpile { funds: number; manpower: number; food: number; stone: number; metal: number; oil: number }
interface OwnCountry {
  id: number; name: string; color: string; controller: string;
  stockpile: Stockpile; income: Stockpile; industryCapacity: number;
  /** Live per-game-hour extraction rate by kind (stone/metal/oil); 0 when idle. */
  upkeep?: Stockpile; netIncome?: Stockpile;
  coverage?: Record<PhysicalResource | 'funds', number>;
  reserveHours?: Record<PhysicalResource | 'funds', number | null>;
  shortages?: Record<PhysicalResource | 'funds', { severity: number; notifiedThreshold: number }>;
  /** Ready strategic warheads (whole count). Absent on pre-strike projections. */
  warheads?: number;
  /** Progression tier — 1, 2, or 3. See game/phase.ts. */
  phase?: number;
  technologies?: Record<TechnologyBranch, number>;
  research?: { branch: TechnologyBranch; targetLevel: number; progressHours: number; totalHours: number };
}
export class RemoteGameSession extends EventTarget {
  state: PlayerProjection;
  get catalogs(): PresentationCatalogs { return this.connection.catalogs; }
  readonly pendingCompletions: Array<{ provinceId: number; unitTypeId: string }> = [];
  readonly pendingBuildings: Array<{ provinceId: number; buildingId: BuildingId }> = [];
  readonly pendingShortages: Array<{ resource: 'funds' | 'food' | 'metal' | 'oil'; threshold: number }> = [];
  readonly pendingCombat: Array<{
    attacker: number; defender: number;
    kind: 'engaged' | 'reinforced' | 'combatPulse' | 'retreat' | 'destroyed'
      | 'bombardment' | 'battleEnded' | 'strike';
    armyId?: string; targetArmyId?: string; battleId?: string; frontId?: string; x?: number; z?: number;
    provinceId?: number; survivorCountryId?: number | null;
  }> = [];
  readonly pendingCaptures: Array<{ provinceId: number; fromCountryId: number; toCountryId: number }> = [];
  readonly pendingCommands = new Map<string, { command: CommandPayload; appliedRevision?: number }>();
  private readonly listeners = new AbortController();

  constructor(
    private readonly connection: GameConnection,
    private readonly commandFailed: (reason: string) => void,
  ) {
    super();
    this.state = structuredClone(connection.state);
    connection.addEventListener('state', () => this.rebuild(), { signal: this.listeners.signal });
    connection.addEventListener('connection-status', () => this.dispatchEvent(new Event('change')), { signal: this.listeners.signal });
    connection.addEventListener('dev-cheat-result', (event) => {
      this.dispatchEvent(new CustomEvent('dev-cheat-result', {
        detail: (event as CustomEvent).detail,
      }));
    }, { signal: this.listeners.signal });
    connection.addEventListener('game-event', (event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      const kind = String(detail.kind ?? '');
      if (kind === 'unitCompleted') {
        this.pendingCompletions.push({
          provinceId: Number(detail.provinceId), unitTypeId: String(detail.unitTypeId),
        });
      } else if (kind === 'buildingCompleted') {
        this.pendingBuildings.push({
          provinceId: Number(detail.provinceId), buildingId: String(detail.buildingId) as BuildingId,
        });
      } else if (kind === 'capture') {
        this.pendingCaptures.push({
          provinceId: Number(detail.provinceId),
          fromCountryId: Number(detail.fromCountryId),
          toCountryId: Number(detail.toCountryId),
        });
      } else if ([
        'engaged', 'reinforced', 'combatPulse', 'retreat', 'destroyed', 'bombardment',
        'battleEnded', 'strike',
      ].includes(kind)) {
        this.pendingCombat.push({
          kind: kind as (typeof this.pendingCombat)[number]['kind'],
          attacker: Number(detail.attacker),
          defender: Number(detail.defender),
          armyId: detail.armyId as string | undefined, targetArmyId: detail.targetArmyId as string | undefined,
          battleId: detail.battleId as string | undefined, frontId: detail.frontId as string | undefined,
          x: detail.x as number | undefined, z: detail.z as number | undefined,
          provinceId: detail.provinceId as number | undefined,
          survivorCountryId: typeof detail.survivorCountryId === 'number' ? detail.survivorCountryId : null,
        });
      }
    }, { signal: this.listeners.signal });
  }

  get playerCountryId(): number { return this.state.viewerCountryId; }
  get ownCountry(): OwnCountry { return this.state.ownCountry as unknown as OwnCountry; }
  readEpochMs(): number { return this.connection.readEpochMs(); }
  readClock(): GameClockReading { return this.connection.readClock(); }

  /**
   * Live headcount of every unit in the player's own army stacks (infantry,
   * tanks, everything with a unit count) — a real military total, not the
   * flavor "national population" figure shown pre-game. Recomputed from the
   * current projection each read, so it stays correct as armies are built,
   * merged, split or destroyed.
   */
  get armySize(): number {
    let total = 0;
    for (const army of Object.values(this.state.armies)) {
      if (army.own && army.composition) total += army.composition.unitCount;
    }
    return total;
  }

  /** Dev/test only. See GameConnection.setDevSimSpeed. */
  get devSimSpeed(): number { return this.connection.devSimSpeed; }
  get debugEnabled(): boolean { return this.connection.debugEnabled; }
  get devSimSpeedEnabled(): boolean { return this.connection.devSimSpeedEnabled; }
  setDevSimSpeed(multiplier: number): void { this.connection.setDevSimSpeed(multiplier); }
  setDevClock(epochMs: number): void { this.connection.setDevClock(epochMs); }
  linkDevClockToTimezone(timeZone: string): void { this.connection.linkDevClockToTimezone(timeZone); }

  get devDiagnostics() { return this.connection.devDiagnostics; }
  setDevWeather(mode: 'automatic' | 'forced-clear' | 'forced-rain'): void { this.connection.setDevWeather(mode); }
  devCheatBuild(provinceId: number, buildingId: BuildingId, level: number): void {
    this.connection.devCheatBuild(provinceId, buildingId, level);
  }
  devCheatSpawnUnit(provinceId: number, countryId: number, unitTypeId: string): void {
    this.connection.devCheatSpawnUnit(provinceId, countryId, unitTypeId);
  }
  devCheatGiveResource(countryId: number, resource: 'funds' | 'manpower' | 'food' | 'stone' | 'metal' | 'oil', amount: number): void {
    this.connection.devCheatGiveResource(countryId, resource, amount);
  }

  unit(typeId: string): Record<string, unknown> | undefined {
    return this.catalogs.units.find((unit) => unit.id === typeId);
  }
  building(id: BuildingId): Record<string, unknown> | undefined {
    return this.catalogs.buildings.find((building) => building.id === id);
  }

  private rebuild(): void {
    const previous = (this.state.ownCountry as unknown as OwnCountry | undefined)?.shortages;
    const next = this.connection.state;
    const current = (next.ownCountry as unknown as OwnCountry | undefined)?.shortages;
    for (const resource of ['funds', 'food', 'metal', 'oil'] as const) {
      const before = previous?.[resource]?.notifiedThreshold ?? 0;
      const after = current?.[resource]?.notifiedThreshold ?? 0;
      if (after > before) this.pendingShortages.push({ resource, threshold: after });
    }
    this.state = next;
    for (const [id, pending] of this.pendingCommands) {
      if (pending.appliedRevision !== undefined && this.connection.revision >= pending.appliedRevision) this.pendingCommands.delete(id);
    }
    this.dispatchEvent(new Event('change'));
  }

  private send(
    command: CommandPayload, onAccepted?: () => void,
  ): { ok: boolean; reason?: string } {
    let id = '';
    id = this.connection.command(command, (ok, reason, requiredWarCountryIds, appliedRevision) => {
      if (ok) {
        const pending = this.pendingCommands.get(id);
        if (pending) pending.appliedRevision = appliedRevision ?? this.connection.revision;
        this.rebuild();
        // Server has accepted the order (after any war confirmation) but combat
        // has not started — the right moment to acknowledge the click.
        onAccepted?.();
      } else if (requiredWarCountryIds?.length) {
        this.pendingCommands.delete(id);
        this.rebuild();
        let answered = false;
        const respond = (confirmed: boolean): void => {
          if (answered) return;
          answered = true;
          if (!confirmed) return;
          const confirmedCommand = {
            ...command, confirmedWarCountryIds: [...new Set([...('confirmedWarCountryIds' in command ? command.confirmedWarCountryIds ?? [] : []), ...requiredWarCountryIds])],
          } as CommandPayload;
          this.send(confirmedCommand, onAccepted);
        };
        this.dispatchEvent(new CustomEvent('war-confirmation', {
          detail: { countryIds: [...requiredWarCountryIds], respond },
        }));
      } else {
        this.pendingCommands.delete(id);
        this.rebuild();
        this.commandFailed(reason ?? 'Command failed.');
      }
    });
    this.pendingCommands.set(id, { command });
    this.rebuild();
    return { ok: true };
  }

  /**
   * Diplomacy is authoritative and never painted optimistically: another
   * player may answer or change the relation at the same time. The optional
   * callback only releases local UI busy state; rejected commands still flow
   * through the session's shared commandFailed notification path.
   */
  private sendDiplomacyCommand(
    command: CommandPayload, onResult?: (ok: boolean) => void,
  ): { ok: true } {
    this.connection.command(command, (ok, reason) => {
      if (!ok) this.commandFailed(reason ?? 'Diplomacy command failed.');
      onResult?.(ok);
    });
    return { ok: true };
  }

  sendDiplomaticMessage(targetCountryId: number, body: string, onResult?: (ok: boolean) => void) {
    return this.sendDiplomacyCommand({
      type: 'sendDiplomaticMessage', targetCountryId, body,
    }, onResult);
  }

  proposeDiplomacy(
    targetCountryId: number, proposal: 'alliance' | 'peace', onResult?: (ok: boolean) => void,
  ) {
    return this.sendDiplomacyCommand({
      type: 'proposeDiplomacy', targetCountryId, proposal,
    }, onResult);
  }

  respondDiplomacy(proposalId: string, accept: boolean, onResult?: (ok: boolean) => void) {
    return this.sendDiplomacyCommand({
      type: 'respondDiplomacy', proposalId, accept,
    }, onResult);
  }

  declareWar(targetCountryId: number, onResult?: (ok: boolean) => void) {
    return this.sendDiplomacyCommand({ type: 'declareWar', targetCountryId }, onResult);
  }

  endAlliance(targetCountryId: number, onResult?: (ok: boolean) => void) {
    return this.sendDiplomacyCommand({ type: 'endAlliance', targetCountryId }, onResult);
  }

  ownsArmy(armyId: string): boolean { return this.state.armies[armyId]?.own ?? false; }
  ownsProvince(provinceId: number): boolean { return this.state.provinceOwners[provinceId] === this.playerCountryId; }

  get fresh(): boolean { return this.connection.fresh; }
  get baselineGeneration(): number { return this.connection.baselineGeneration; }
  serverNow(): number { return this.connection.serverNow(); }
  dispose(): void { this.listeners.abort(); this.pendingCommands.clear(); }
  pendingForArmy(armyId: string): boolean { return [...this.pendingCommands.values()].some(({ command }) => 'armyId' in command && command.armyId === armyId); }
  pendingForProvince(provinceId: number): boolean {
    return [...this.pendingCommands.values()].some(({ command }) =>
      'provinceId' in command && command.provinceId === provinceId);
  }
  pendingResearch(): boolean {
    return [...this.pendingCommands.values()].some(({ command }) => command.type === 'research');
  }

  orderMove(armyId: string, x: number, z: number, intent: 'move' | 'attack' = 'move') {
    if (intent === 'attack') return { ok: false, reason: 'Choose an attack target.' };
    return this.send({ type: 'moveArmy', armyId, x, z });
  }
  orderAttackProvince(armyId: string, provinceId: number, x: number, z: number, onAccepted?: () => void) {
    return this.send({ type: 'attackArmy', armyId, target: { kind: 'province', provinceId, x, z } }, onAccepted);
  }
  /**
   * Strategic strike on an enemy province. Country-level order (no army), never
   * painted optimistically — the server consumes the warhead and declares war.
   */
  orderStrike(provinceId: number, x: number, z: number, onAccepted?: () => void) {
    if ((this.ownCountry.warheads ?? 0) < 1) {
      return { ok: false, reason: 'No warhead is ready.' } as const;
    }
    return this.send({ type: 'strike', provinceId, x, z }, onAccepted);
  }
  orderAttackArmy(armyId: string, targetArmyId: string, onAccepted?: () => void) {
    return this.send({ type: 'attackArmy', armyId, target: { kind: 'army', armyId: targetArmyId } }, onAccepted);
  }
  orderRetreat(armyId: string, x: number, z: number) { return this.send({ type: 'retreatArmy', armyId, x, z }); }
  orderSplit(armyId: string, groups: readonly { typeId: string; count: number }[], x: number, z: number) {
    return this.send({ type: 'splitArmy', armyId, groups: [...groups], x, z });
  }
  orderStop(armyId: string): boolean { this.send({ type: 'stopArmy', armyId }); return true; }
  orderStance(armyId: string, stance: ArmyStance): boolean {
    this.send({ type: 'setStance', armyId, stance });
    return true;
  }
  orderExtract(armyId: string, resource?: PhysicalResource) {
    const selected = resource ?? this.state.armies[armyId]?.actions?.extractableResources[0];
    return selected ? this.send({ type: 'extract', armyId, resource: selected })
      : { ok: false, reason: 'Choose a resource.' };
  }
  produce(provinceId: number, unitTypeId: string) { return this.send({ type: 'produce', provinceId, unitTypeId }); }
  build(provinceId: number, buildingId: BuildingId, onAccepted?: () => void) {
    return this.send({ type: 'build', provinceId, buildingId }, onAccepted);
  }
  research(branch: TechnologyBranch, onAccepted?: () => void) {
    return this.send({ type: 'research', branch }, onAccepted);
  }
  setRally(provinceId: number, x: number, z: number) { return this.send({ type: 'setRally', provinceId, target: { x, z } }); }
  clearRally(provinceId: number) { return this.send({ type: 'setRally', provinceId, target: null }); }
  rallyPoint(provinceId: number): { x: number; z: number; route?: Array<{ x: number; z: number }> } | null {
    return this.state.rallyPoints[provinceId] ?? null;
  }

  productionOptions(provinceId: number) { return this.state.provinceActions[provinceId]?.production ?? []; }
  buildable(provinceId: number): Array<{ id: BuildingId; available: boolean; affordable: boolean; targetTier?: number; reason?: string }> {
    return (this.state.provinceActions[provinceId]?.construction ?? [])
      .map((option) => ({ id: option.buildingId, available: option.available, affordable: option.affordable, targetTier: option.targetTier, reason: option.reason }));
  }
  canSetRally(provinceId: number): boolean { return this.state.provinceActions[provinceId]?.canSetRally ?? false; }
  extractableNodeAt(armyId: string): number | null {
    const action = this.state.armies[armyId]?.actions;
    return action?.canExtract ? action.extractionProvinceId : null;
  }
  army(armyId: string): ProjectedArmy | null { return this.state.armies[armyId] ?? null; }
  describeProvince(provinceId: number) {
    const ownerId = this.state.provinceOwners[provinceId] ?? 0;
    const owner = this.state.countries[ownerId];
    const isOwn = ownerId === this.playerCountryId;
    const totals = { stone: 0, metal: 0, oil: 0 };
    let any = false;
    let controlled = false;
    let extracting = false;
    const economy = this.state.provinceEconomies?.[provinceId] as {
      resourcePotential?: Record<PhysicalResource, number>; baseProduction?: Stockpile;
      resourceBuildings?: Record<'fields' | 'quarry' | 'mine' | 'oilPump', number>;
      productionBreakdown?: Record<PhysicalResource, {
        base: number; passive: number; engineer: number; total: number;
        assignedEngineers: number; effectiveEngineers: number; currentTier: number; maximumTier: number;
      }>;
    } | undefined;
    if (economy?.baseProduction) {
      any = true;
      totals.stone = economy.baseProduction.stone;
      totals.metal = economy.baseProduction.metal;
      totals.oil = economy.baseProduction.oil;
      controlled = isOwn;
      extracting = Object.values(this.state.armies).some((army) => army.own && army.status === 'extracting');
    }
    const occupied = isOwn && (this.state.provinceActions[provinceId]?.occupied ?? false);
    return {
      ownerId, ownerName: owner?.name ?? `Country ${ownerId}`, ownerColor: owner?.color ?? '#888888', isOwn,
      resources: any ? totals : null, controlled, extracting, occupied,
      resourceEconomy: isOwn && economy?.resourcePotential && economy.resourceBuildings && economy.baseProduction ? {
        potential: economy.resourcePotential, baseProduction: economy.baseProduction, buildings: economy.resourceBuildings,
        productionBreakdown: economy.productionBreakdown,
      } : null,
    };
  }
}
