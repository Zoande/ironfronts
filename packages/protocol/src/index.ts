import { z } from 'zod';

export const PROTOCOL_VERSION = 4 as const;
export const GAME_ID = 'world-at-war-2' as const;
export const GAME_VERSION = 'world-at-war@4' as const;

const confirmedWars = z.array(z.number().int().positive()).optional();
const attackTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('province'), provinceId: z.number().int().nonnegative(),
    x: z.number().finite().optional(), z: z.number().finite().optional(),
  }),
  z.object({ kind: z.literal('army'), armyId: z.string().min(1) }),
]);

export const commandPayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('moveArmy'), armyId: z.string(), x: z.number().finite(), z: z.number().finite(), confirmedWarCountryIds: confirmedWars }),
  z.object({ type: z.literal('attackArmy'), armyId: z.string(), target: attackTargetSchema, confirmedWarCountryIds: confirmedWars }),
  z.object({ type: z.literal('retreatArmy'), armyId: z.string(), x: z.number().finite(), z: z.number().finite() }),
  z.object({
    type: z.literal('splitArmy'), armyId: z.string(),
    groups: z.array(z.object({ typeId: z.string(), count: z.number().int().nonnegative() })).min(1),
    x: z.number().finite(), z: z.number().finite(), confirmedWarCountryIds: confirmedWars,
  }),
  z.object({ type: z.literal('stopArmy'), armyId: z.string() }),
  z.object({
    type: z.literal('setStance'), armyId: z.string(),
    stance: z.enum(['attack', 'attack-defend', 'defend', 'defend-retreat', 'retreat']),
  }),
  z.object({ type: z.literal('extract'), armyId: z.string(), resource: z.enum(['food', 'stone', 'metal', 'oil']) }),
  z.object({ type: z.literal('produce'), provinceId: z.number().int().nonnegative(), unitTypeId: z.string() }),
  z.object({ type: z.literal('build'), provinceId: z.number().int().nonnegative(), buildingId: z.enum(['barracks', 'tankPlant', 'ordnance', 'missileSite', 'fields', 'quarry', 'mine', 'oilPump']) }),
  z.object({ type: z.literal('research'), branch: z.enum(['infantry', 'resources', 'training', 'hybrid', 'armored']) }),
  z.object({ type: z.literal('setRally'), provinceId: z.number().int().nonnegative(), target: z.object({ x: z.number().finite(), z: z.number().finite() }).nullable() }),
  z.object({
    type: z.literal('sendDiplomaticMessage'),
    targetCountryId: z.number().int().positive(),
    body: z.string().min(1).max(500),
  }),
  z.object({
    type: z.literal('proposeDiplomacy'),
    targetCountryId: z.number().int().positive(),
    proposal: z.enum(['alliance', 'peace']),
  }),
  z.object({
    type: z.literal('respondDiplomacy'),
    proposalId: z.string().min(1).max(100),
    accept: z.boolean(),
  }),
  z.object({ type: z.literal('declareWar'), targetCountryId: z.number().int().positive() }),
  z.object({ type: z.literal('endAlliance'), targetCountryId: z.number().int().positive() }),
  z.object({
    type: z.literal('strike'), provinceId: z.number().int().nonnegative(),
    x: z.number().finite(), z: z.number().finite(),
  }),
]);
export type CommandPayload = z.infer<typeof commandPayloadSchema>;

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('authenticate'), protocolVersion: z.literal(PROTOCOL_VERSION), ticket: z.string().min(1) }),
  z.object({ type: z.literal('command'), commandId: z.string().min(1).max(100), command: commandPayloadSchema }),
  z.object({ type: z.literal('resync'), afterRevision: z.number().int().nonnegative().optional() }),
  // Dev/test only — the server ignores this in production regardless of who
  // sends it (see gameplay-gateway.ts). Not a gameplay command: it changes
  // the whole server's simulation pace for every connected player, so it is
  // never wrapped in the commandId-acked command envelope above.
  z.object({ type: z.literal('devSetClock'), epochMs: z.number().finite().min(-8.64e15).max(8.64e15) }),
  z.object({ type: z.literal('ping'), sentAt: z.number().finite() }),
  z.object({ type: z.literal('devSetSimSpeed'), multiplier: z.number().finite().min(1).max(10_000) }),
  z.object({ type: z.literal('devLinkClockTimezone'), timeZone: z.string().min(1).max(100) }),
  z.object({ type: z.literal('devSetWeather'), mode: z.enum(['automatic', 'forced-clear', 'forced-rain']) }),
  z.object({ type: z.literal('devCheatBuild'), provinceId: z.number().int().nonnegative(),
    buildingId: z.enum(['barracks', 'tankPlant', 'ordnance', 'missileSite', 'fields', 'quarry', 'mine', 'oilPump']),
    level: z.number().int().min(1).max(8) }),
  z.object({ type: z.literal('devCheatSpawnUnit'), provinceId: z.number().int().nonnegative(),
    countryId: z.number().int().positive(), unitTypeId: z.string().min(1).max(50) }),
  z.object({ type: z.literal('devCheatGiveResource'), countryId: z.number().int().positive(),
    resource: z.enum(['funds', 'manpower', 'food', 'stone', 'metal', 'oil']),
    amount: z.number().finite().positive().max(1_000_000_000) }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export interface PublicCountry {
  id: number;
  name: string;
  color: string;
  controller: 'player' | 'ai' | 'neutral';
  alive: boolean;
}

export interface DiplomacyMessage {
  id: string;
  fromCountryId: number;
  toCountryId: number;
  body: string;
  sentAtTick: number;
}

export interface DiplomacyProposal {
  id: string;
  fromCountryId: number;
  toCountryId: number;
  kind: 'alliance' | 'peace';
  status: 'pending' | 'accepted' | 'declined' | 'withdrawn';
  createdAtTick: number;
  resolvedAtTick?: number;
}

export interface CombatRateModifiers {
  frontageUsed: number;
  frontageLimit: number;
  coordination: number;
  organization: number;
  stanceOutput: number;
  supply: number;
  protection: number;
  terrain: number;
  devastation: number;
}

export interface ProjectedArmy {
  id: string;
  name: string;
  ownerCountryId: number;
  ownerName: string;
  ownerColor: string;
  x: number;
  z: number;
  own: boolean;
  contact: 'contact' | 'visible';
  status: string;
  /** Current road-graph node. Own armies only (server projection fills it);
   *  the client needs it to tell whether the stack is actually on a deposit's
   *  access node before offering Extract. */
  graphNodeId?: number;
  composition: null | {
    unitCount: number;
    health: number;
    /** Organization/readiness, 0..1 of max — separate from health. */
    organization: number;
    /** Entrenchment, 0..1 of max. */
    entrenchment: number;
    /** Combat posture; see game/units/army.ts ArmyStance. */
    stance: 'attack' | 'attack-defend' | 'defend' | 'defend-retreat' | 'retreat';
    /** Within reach of the owner's own territory. */
    inSupply: boolean;
    speed: number;
    groups: ReadonlyArray<{ typeId: string; count: number; health: number }>;
  };
  moveOrder: { x: number; z: number } | null;
  /** Authoritative road-graph route for an own army's active order (world-space
   *  points, army position first, destination last). Absent/[] for foreign or
   *  idle stacks. */
  moveRoute?: ReadonlyArray<{ x: number; z: number }>;
  moveIntent?: 'move' | 'attack';
  /** Next authoritative movement waypoint and wall-clock time remaining. */
  motion?: {
    targetX: number; targetZ: number; durationMs: number;
    /** Remaining authoritative road polyline, beginning at the sampled position. */
    route?: ReadonlyArray<{ x: number; z: number }>;
    sampledAtEpochMs?: number; generation?: number;
  };
  actions?: { canExtract: boolean; extractionProvinceId: number | null; extractableResources: Array<'food' | 'stone' | 'metal' | 'oil'>; extractReason?: string };
  shortage?: {
    severity: Record<'funds' | 'food' | 'metal' | 'oil', number>;
    modifiers: Record<'combatOutput' | 'movementSpeed' | 'visionRange' | 'extractionOutput' | 'organizationCap', number>;
  };
  suspendedOrder?: { x: number; z: number; intent: 'move' | 'attack' } | null;
  battleFronts?: ReadonlyArray<{
    id: string;
    directionNodeId: number;
    role: 'attack' | 'defense';
    friendlyHp: number;
    friendlyBaselineHp: number;
    enemyHp: number;
    enemyBaselineHp: number;
    reinforcementCount: number;
    outgoingDamagePerGameHour: number;
    incomingDamagePerGameHour: number;
    friendlyCasualties: number;
    enemyCasualties: number;
    estimatedGameHours: number | null;
    estimatedRealSeconds: number | null;
    friendlyModifiers: CombatRateModifiers;
    enemyModifiers: CombatRateModifiers;
  }>;
  legalRetreatExits?: ReadonlyArray<{
    firstNodeId: number; destinationProvinceId: number; x: number; z: number;
    /** 8-point compass label for the withdrawal direction (server-computed). */
    bearing?: string;
  }>;
  artillery?: {
    range: number;
    targetArmyId: string | null;
    manualTarget: boolean;
  } | null;
}

export interface PlayerProjection {
  simulationTick: number;
  timeline?: { elapsedSeconds: number; speed: number; sampledAtEpochMs: number; generation: number };
  viewerCountryId: number;
  startCamera: { x: number; z: number; distance: number };
  countries: Record<number, PublicCountry>;
  provinceOwners: Record<number, number>;
  provinceBuildings: Record<number, { barracks: number; tankPlant: number; ordnance: number; missileSite: number }>;
  provinceActions: Record<number, {
    production: ReadonlyArray<{ unitTypeId: string; available: boolean; affordable: boolean; reason?: string }>;
    construction: ReadonlyArray<{ buildingId: 'barracks' | 'tankPlant' | 'ordnance' | 'missileSite' | 'fields' | 'quarry' | 'mine' | 'oilPump'; available: boolean; affordable: boolean; targetTier?: number; reason?: string }>;
    canSetRally: boolean;
    rallyReason?: string;
    /** Held by someone other than its original owner — produces less (see
     *  game/economy.ts's OCCUPIED_INCOME_MULTIPLIER). */
    occupied: boolean;
  }>;
  productionQueues: Record<number, unknown[]>;
  constructionQueues: Record<number, unknown[]>;
  // `route` is the server-derived road polyline from the province's node to the
  // rally point — the same planner a produced unit will actually walk. Derived
  // per projection, not persisted; absent until the graph resolves one.
  rallyPoints: Record<number, { x: number; z: number; route?: Array<{ x: number; z: number }> }>;
  armies: Record<string, ProjectedArmy>;
  provinceEconomies?: Record<number, unknown>;
  /** Deprecated and empty in protocol v4. */
  resourceNodes?: Record<number, unknown>;
  ownCountry: null | Record<string, unknown>;
  relations: Record<string, 'peace' | 'allied' | 'war'>;
  weather?: { mode: 'automatic' | 'forced-clear' | 'forced-rain'; raining: boolean;
    scheduleDay: string; rainStartMinute: number; rainDurationMinutes: number };
  diplomacy?: {
    messages: DiplomacyMessage[];
    proposals: DiplomacyProposal[];
  };
  /** Set once the campaign is decided from the viewer's point of view. */
  outcome?: {
    result: 'victory' | 'defeat';
    reason: string;
    atGameHours: number;
  };
}

/**
 * Sparse visual-world-clock sample. Clients advance it at one second per real
 * second. Campaign elapsed time is carried separately for the day counter.
 */
export interface GameClockSync {
  gameStartedAtEpochMs: number;
  gameEpochMs: number;
  campaignElapsedSeconds?: number;
  speed: number;
  generation: number;
  serverEpochMs: number;
  utcOffsetMinutes: number;
  timezoneLinked?: boolean;
  timeZone?: string;
}

export interface PresentationCatalogs {
  units: ReadonlyArray<Record<string, unknown>>;
  buildings: ReadonlyArray<Record<string, unknown>>;
}

export interface WorldDescriptor {
  artifactHashes: Record<string, string>;
  version: string;
  hash: string;
  assetBaseUrl: string;
}

export type ProjectionCollection = 'countries' | 'provinceOwners' | 'provinceBuildings' | 'provinceEconomies' | 'provinceActions' | 'productionQueues' | 'constructionQueues' | 'rallyPoints' | 'armies' | 'relations';
export type ProjectionDelta = {
  changed: Partial<Omit<PlayerProjection, ProjectionCollection>>;
  upserts: Partial<{ [K in ProjectionCollection]: Record<string, unknown> }>;
  removals: Partial<Record<ProjectionCollection, string[]>>;
  redactions: string[];
};

export type ServerMessage =
  | { type: 'hello'; gameId: string; gameVersion: string; protocolVersion: 4; capabilities: string[]; world: WorldDescriptor; countryId: number; debugEnabled: boolean }
  | { type: 'baseline'; revision: number; state: PlayerProjection; catalogs: PresentationCatalogs; clock: GameClockSync }
  | { type: 'delta'; fromRevision: number; revision: number; delta: ProjectionDelta; events: FilteredEvent[] }
  | { type: 'clockSync'; clock: GameClockSync }
  | { type: 'commandAck'; commandId: string; ok: boolean; appliedRevision?: number; reason?: string; requiredWarCountryIds?: readonly number[] }
  | { type: 'event'; event: FilteredEvent }
  | { type: 'pong'; sentAt: number; serverEpochMs: number }
  | { type: 'error'; code: string; message: string; retryable?: boolean }
  // Sent right after `baseline` and again whenever the multiplier changes.
  // `devControlsEnabled: false` in production — the server ignores
  // devSetSimSpeed there regardless, but the client uses this to hide the
  // control entirely rather than offer a lever that silently does nothing.
  | { type: 'devSimSpeed'; multiplier: number; devControlsEnabled: boolean }
  | { type: 'devDiagnostics'; requestedSpeed: number; effectiveSpeed: number; pendingSimulationSeconds: number;
      lastPumpSteps: number; lastPumpMilliseconds: number; overloaded: boolean; devControlsEnabled: boolean }
  | { type: 'devCheatResult'; action: 'build' | 'spawn' | 'resource'; ok: boolean; message: string };

export { serverMessageSchema } from './server-schema';

type EventBase = { id: string; message?: string };
type LocatedEvent = EventBase & { x: number; z: number };
type CombatCountries = { attacker: number; defender: number };
export type FilteredEvent =
  | LocatedEvent & { kind: 'unitCompleted'; ownerCountryId: number; provinceId: number; unitTypeId: string; armyId: string }
  | LocatedEvent & { kind: 'buildingCompleted'; ownerCountryId: number; provinceId: number; buildingId: 'barracks' | 'tankPlant' | 'ordnance' | 'missileSite' | 'fields' | 'quarry' | 'mine' | 'oilPump' }
  | LocatedEvent & { kind: 'capture'; provinceId: number; fromCountryId: number; toCountryId: number }
  | LocatedEvent & CombatCountries & { kind: 'engaged' | 'combatPulse' | 'retreat' | 'battleEnded'; battleId: string; frontId: string }
  | LocatedEvent & CombatCountries & { kind: 'reinforced'; battleId: string; frontId: string; armyId: string }
  | LocatedEvent & CombatCountries & { kind: 'destroyed'; armyId: string; battleId?: string; frontId?: string }
  | LocatedEvent & CombatCountries & { kind: 'bombardment'; armyId: string; targetArmyId: string }
  | LocatedEvent & CombatCountries & { kind: 'strike'; provinceId: number };

export interface GameTicketClaims {
  accountId: string;
  gameId: string;
  countryId: number;
  audience: 'game-server';
  protocolVersion: 4;
  expiresAt: number;
  nonce: string;
}

export interface LobbyCountry { id: number; name: string; color: string; startingCities: number; alive: boolean; claimed: boolean }
export interface GameLobby {
  gameId: string;
  name: string;
  gameVersion: string;
  protocolVersion: 4;
  assignedCountryId: number | null;
  countries: LobbyCountry[];
}

/**
 * Persisted commander progression. A brand-new account is genuinely
 * `{ level: 1, xp: 0, achievements: [] }` — there is no gameplay XP award wired
 * up yet, so every field is a real stored default, never a fabricated stat.
 * `level` is always recomputed from `xp` on read (see `commanderLevelForXp`), so
 * the two can never drift.
 */
export interface CommanderProfile {
  level: number;
  xp: number;
  /** XP accumulated since reaching the current level. */
  xpIntoLevel: number;
  /** XP span of the current level (`xpIntoLevel / xpForNextLevel` fills the bar). */
  xpForNextLevel: number;
  achievements: string[];
}

/** Cumulative XP required to *reach* `level` (level 1 = 0). Quadratic ramp. */
export function commanderXpForLevel(level: number): number {
  const n = Math.max(1, Math.floor(level));
  return 50 * (n - 1) * n;
}

/** Highest level whose XP threshold `xp` has cleared. Inverse of the above. */
export function commanderLevelForXp(xp: number): number {
  const safe = Math.max(0, Math.floor(xp));
  let level = 1;
  while (commanderXpForLevel(level + 1) <= safe) level += 1;
  return level;
}

/** Derive the full profile view from the two stored fields. */
export function commanderProfileFromXp(xp: number, achievements: string[]): CommanderProfile {
  const level = commanderLevelForXp(xp);
  const base = commanderXpForLevel(level);
  return {
    level,
    xp,
    xpIntoLevel: xp - base,
    xpForNextLevel: commanderXpForLevel(level + 1) - base,
    achievements,
  };
}

export interface SessionResponse {
  authenticated: boolean;
  account?: { id: string; username: string };
  assignment?: { gameId: string; countryId: number } | null;
  profile?: CommanderProfile;
}
export interface ConnectResponse { ticket: string; websocketUrl: string; protocolVersion: 4 }

export const credentialsSchema = z.object({
  username: z.string().trim().min(3).max(32),
  password: z.string().min(8).max(256),
});
export const joinGameSchema = z.object({ countryId: z.number().int().positive() });
