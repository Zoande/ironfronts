import { z } from 'zod';

export const PROTOCOL_VERSION = 2 as const;
export const GAME_ID = 'world-at-war-2' as const;
export const GAME_VERSION = 'world-at-war@2' as const;

const confirmedWars = z.array(z.number().int().positive()).optional();
const attackTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('province'), provinceId: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('army'), armyId: z.string().min(1) }),
]);

export const commandPayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('moveArmy'), armyId: z.string(), x: z.number().finite(), z: z.number().finite(), confirmedWarCountryIds: confirmedWars }),
  z.object({ type: z.literal('attackArmy'), armyId: z.string(), target: attackTargetSchema, confirmedWarCountryIds: confirmedWars }),
  z.object({ type: z.literal('retreatArmy'), armyId: z.string(), firstNodeId: z.number().int().nonnegative() }),
  z.object({
    type: z.literal('splitArmy'), armyId: z.string(),
    groups: z.array(z.object({ typeId: z.string(), count: z.number().int().nonnegative() })).min(1),
    x: z.number().finite(), z: z.number().finite(), confirmedWarCountryIds: confirmedWars,
  }),
  z.object({ type: z.literal('stopArmy'), armyId: z.string() }),
  z.object({ type: z.literal('extract'), armyId: z.string() }),
  z.object({ type: z.literal('produce'), provinceId: z.number().int().nonnegative(), unitTypeId: z.string() }),
  z.object({ type: z.literal('build'), provinceId: z.number().int().nonnegative(), buildingId: z.enum(['barracks', 'tankPlant', 'ordnance']) }),
  z.object({ type: z.literal('setRally'), provinceId: z.number().int().nonnegative(), target: z.object({ x: z.number().finite(), z: z.number().finite() }).nullable() }),
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
  z.object({ type: z.literal('devSetSimSpeed'), multiplier: z.number().finite().min(0).max(32) }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export interface PublicCountry {
  id: number;
  name: string;
  color: string;
  controller: 'player' | 'ai' | 'neutral';
  alive: boolean;
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
  composition: null | {
    unitCount: number;
    health: number;
    speed: number;
    groups: ReadonlyArray<{ typeId: string; count: number; health: number }>;
  };
  moveOrder: { x: number; z: number } | null;
  /** Authoritative road-graph route for an own army's active order (world-space
   *  points, army position first, destination last). Absent/[] for foreign or
   *  idle stacks. */
  moveRoute?: ReadonlyArray<{ x: number; z: number }>;
  moveIntent?: 'move' | 'attack';
  suspendedOrder?: { x: number; z: number; intent: 'move' | 'attack' } | null;
  battleFronts?: ReadonlyArray<{
    id: string;
    directionNodeId: number;
    role: 'attack' | 'defense';
    friendlyHp: number;
    friendlyBaselineHp: number;
    enemyHp: number;
    enemyBaselineHp: number;
    friendlyNextVolleyTick: number;
    enemyNextVolleyTick: number;
    reinforcementCount: number;
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
    nextVolleyTick: number;
  } | null;
}

export interface PlayerProjection {
  simulationTick: number;
  viewerCountryId: number;
  startCamera: { x: number; z: number; distance: number };
  countries: Record<number, PublicCountry>;
  provinceOwners: Record<number, number>;
  provinceBuildings: Record<number, { barracks: number; tankPlant: number; ordnance: number }>;
  productionQueues: Record<number, unknown[]>;
  constructionQueues: Record<number, unknown[]>;
  // `route` is the server-derived road polyline from the province's node to the
  // rally point — the same planner a produced unit will actually walk. Derived
  // per projection, not persisted; absent until the graph resolves one.
  rallyPoints: Record<number, { x: number; z: number; route?: Array<{ x: number; z: number }> }>;
  armies: Record<string, ProjectedArmy>;
  resourceNodes: Record<number, unknown>;
  ownCountry: null | Record<string, unknown>;
  relations: Record<string, 'peace' | 'war'>;
}

/**
 * Sparse authoritative civil-clock sample. Clients advance `serverEpochMs`
 * locally at one second per real second and use later samples only to correct
 * drift. The offset is deliberately fixed rather than taken from the host OS.
 */
export interface GameClockSync {
  gameStartedAtEpochMs: number;
  serverEpochMs: number;
  utcOffsetMinutes: number;
}

export interface PresentationCatalogs {
  units: ReadonlyArray<Record<string, unknown>>;
  buildings: ReadonlyArray<Record<string, unknown>>;
}

export interface WorldDescriptor {
  version: string;
  hash: string;
  assetBaseUrl: string;
}

export type ProjectionDelta = {
  changed: Partial<Omit<PlayerProjection, 'countries' | 'provinceOwners' | 'provinceBuildings' | 'productionQueues' | 'constructionQueues' | 'rallyPoints' | 'armies' | 'resourceNodes' | 'relations'>>;
  upserts: Partial<{ [K in 'countries' | 'provinceOwners' | 'provinceBuildings' | 'productionQueues' | 'constructionQueues' | 'rallyPoints' | 'armies' | 'resourceNodes' | 'relations']: Record<string, unknown> }>;
  removals: Partial<Record<'countries' | 'provinceOwners' | 'provinceBuildings' | 'productionQueues' | 'constructionQueues' | 'rallyPoints' | 'armies' | 'resourceNodes' | 'relations', string[]>>;
  redactions: string[];
};

export type ServerMessage =
  | { type: 'hello'; gameId: string; gameVersion: string; protocolVersion: 2; capabilities: string[]; world: WorldDescriptor; countryId: number }
  | { type: 'baseline'; revision: number; state: PlayerProjection; catalogs: PresentationCatalogs; clock: GameClockSync }
  | { type: 'delta'; fromRevision: number; revision: number; delta: ProjectionDelta; events: FilteredEvent[] }
  | { type: 'clockSync'; clock: GameClockSync }
  | { type: 'commandAck'; commandId: string; ok: boolean; reason?: string; requiredWarCountryIds?: readonly number[] }
  | { type: 'event'; event: FilteredEvent }
  | { type: 'error'; code: string; message: string; retryable?: boolean }
  // Sent right after `baseline` and again whenever the multiplier changes.
  // `devControlsEnabled: false` in production — the server ignores
  // devSetSimSpeed there regardless, but the client uses this to hide the
  // control entirely rather than offer a lever that silently does nothing.
  | { type: 'devSimSpeed'; multiplier: number; devControlsEnabled: boolean };

export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'), gameId: z.string(), gameVersion: z.string(),
    protocolVersion: z.literal(PROTOCOL_VERSION), capabilities: z.array(z.string()),
    world: z.object({ version: z.string(), hash: z.string(), assetBaseUrl: z.url() }),
    countryId: z.number().int().positive(),
  }),
  z.object({
    type: z.literal('baseline'), revision: z.number().int().nonnegative(),
    state: z.custom<PlayerProjection>((value) => Boolean(value && typeof value === 'object')),
    catalogs: z.custom<PresentationCatalogs>((value) => Boolean(value && typeof value === 'object')),
    clock: z.object({
      gameStartedAtEpochMs: z.number().finite(), serverEpochMs: z.number().finite(),
      utcOffsetMinutes: z.number().int(),
    }),
  }),
  z.object({ type: z.literal('delta'), fromRevision: z.number().int().nonnegative(), revision: z.number().int().nonnegative(), delta: z.custom<ProjectionDelta>((value) => Boolean(value && typeof value === 'object')), events: z.array(z.custom<FilteredEvent>((value) => Boolean(value && typeof value === 'object'))) }),
  z.object({
    type: z.literal('clockSync'),
    clock: z.object({
      gameStartedAtEpochMs: z.number().finite(), serverEpochMs: z.number().finite(),
      utcOffsetMinutes: z.number().int(),
    }),
  }),
  z.object({ type: z.literal('commandAck'), commandId: z.string(), ok: z.boolean(), reason: z.string().optional(), requiredWarCountryIds: z.array(z.number().int().positive()).optional() }),
  z.object({ type: z.literal('event'), event: z.custom<FilteredEvent>((value) => Boolean(value && typeof value === 'object')) }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string(), retryable: z.boolean().optional() }),
  z.object({
    type: z.literal('devSimSpeed'), multiplier: z.number().finite().min(0).max(32),
    devControlsEnabled: z.boolean(),
  }),
]);

export interface FilteredEvent { id: string; kind: string; message?: string; [key: string]: unknown }

export interface GameTicketClaims {
  accountId: string;
  gameId: string;
  countryId: number;
  audience: 'game-server';
  protocolVersion: 2;
  expiresAt: number;
  nonce: string;
}

export interface LobbyCountry { id: number; name: string; color: string; startingCities: number; alive: boolean; claimed: boolean }
export interface GameLobby {
  gameId: string;
  name: string;
  gameVersion: string;
  protocolVersion: 2;
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
export interface ConnectResponse { ticket: string; websocketUrl: string; protocolVersion: 2 }

export const credentialsSchema = z.object({
  username: z.string().trim().min(3).max(32),
  password: z.string().min(8).max(256),
});
export const joinGameSchema = z.object({ countryId: z.number().int().positive() });
