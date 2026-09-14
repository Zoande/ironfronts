import { z } from 'zod';
import type { ServerMessage } from './index';

const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const integer = z.number().int().nonnegative();
const point = z.object({ x: finite, z: finite });
const buildingId = z.enum(['barracks', 'tankPlant', 'ordnance', 'missileSite', 'fields', 'quarry', 'mine', 'oilPump']);
const stockpile = z.object({ funds: finite, manpower: finite, food: finite, stone: finite, metal: finite, oil: finite });
const country = z.object({ id: integer, name: z.string(), color: z.string(), controller: z.enum(['player', 'ai', 'neutral']), alive: z.boolean() });
const buildings = z.object({ barracks: integer.max(8), tankPlant: integer.max(8), ordnance: integer.max(8), missileSite: integer.max(8) });
const queue = z.object({ id: z.string(), ownerCountryId: integer, progressWork: nonnegative.optional(), totalWork: finite.positive().optional(), progressHours: nonnegative.optional(), totalHours: finite.positive().optional(), targetTier: integer.optional(), workRate: finite.positive().optional() });
const unitQueue = queue.extend({ unitTypeId: z.string() });
const buildingQueue = queue.extend({ buildingId });
const resource = point.extend({ id: integer, kind: z.enum(['stone', 'metal', 'oil']), remaining: nonnegative,
  initialAmount: nonnegative, controllerCountryId: integer, provinceId: z.number().int(), accessNodeId: z.number().int(),
  extractorArmyId: z.string().nullable(), status: z.enum(['idle', 'secured', 'extracting', 'exhausted']),
  provenance: z.enum(['generatedNatural', 'scenarioGuarantee']) });
const record = <T extends z.ZodType>(schema: T) => z.record(z.string(), schema);
const combatRateModifiers = z.object({
  frontageUsed: integer, frontageLimit: integer, coordination: nonnegative,
  organization: nonnegative, stanceOutput: nonnegative, supply: nonnegative,
  protection: nonnegative, terrain: nonnegative, devastation: nonnegative,
});
const army = point.extend({
  id: z.string(), name: z.string(), ownerCountryId: integer, ownerName: z.string(), ownerColor: z.string(), own: z.boolean(),
  contact: z.enum(['contact', 'visible']), status: z.enum(['idle', 'moving', 'extracting', 'engaged', 'retreating', 'embarking', 'atSea', 'disembarking', 'unknown']),
  graphNodeId: integer.optional(),
  composition: z.object({ unitCount: integer, health: nonnegative.max(1),
    organization: nonnegative.max(1), entrenchment: nonnegative.max(1),
    stance: z.enum(['attack', 'attack-defend', 'defend', 'defend-retreat', 'retreat']), inSupply: z.boolean(), speed: nonnegative,
    groups: z.array(z.object({ typeId: z.string(), count: integer, health: nonnegative.max(1) })) }).nullable(),
  moveOrder: point.nullable(), moveRoute: z.array(point).optional(), moveIntent: z.enum(['move', 'attack']).optional(),
  motion: z.object({ targetX: finite, targetZ: finite, durationMs: nonnegative, route: z.array(point).optional(), sampledAtEpochMs: finite.optional(), generation: integer.optional() }).optional(),
  actions: z.object({ canExtract: z.boolean(), extractionProvinceId: integer.nullable(), extractableResources: z.array(z.enum(['food', 'stone', 'metal', 'oil'])), extractReason: z.string().optional() }).optional(),
  shortage: z.object({ severity: z.record(z.string(), nonnegative), modifiers: z.record(z.string(), nonnegative) }).optional(),
  suspendedOrder: point.extend({ intent: z.enum(['move', 'attack']) }).nullable().optional(),
  battleFronts: z.array(z.object({ id: z.string(), directionNodeId: integer, role: z.enum(['attack', 'defense']),
    friendlyHp: nonnegative, friendlyBaselineHp: nonnegative, enemyHp: nonnegative, enemyBaselineHp: nonnegative,
    reinforcementCount: integer, outgoingDamagePerGameHour: nonnegative, incomingDamagePerGameHour: nonnegative,
    friendlyCasualties: nonnegative, enemyCasualties: nonnegative,
    estimatedGameHours: nonnegative.nullable(), estimatedRealSeconds: nonnegative.nullable(),
    friendlyModifiers: combatRateModifiers, enemyModifiers: combatRateModifiers })).optional(),
  legalRetreatExits: z.array(point.extend({ firstNodeId: integer, destinationProvinceId: integer, bearing: z.string().optional() })).optional(),
  artillery: z.object({ range: nonnegative, targetArmyId: z.string().nullable(), manualTarget: z.boolean() }).nullable().optional(),
});
const timeline = z.object({ elapsedSeconds: nonnegative, speed: finite.min(1).max(10_000), sampledAtEpochMs: finite, generation: integer });
const ownCountry = z.object({ id: integer, name: z.string(), color: z.string(), controller: z.enum(['player', 'ai', 'neutral']),
  stockpile, income: stockpile, industryCapacity: nonnegative, warheads: nonnegative.optional(), phase: integer.optional(),
  technologies: z.object({ infantry: integer.min(1).max(8), resources: integer.min(1).max(8), training: integer.min(1).max(8), hybrid: integer.min(1).max(8), armored: integer.min(1).max(8) }).optional(),
  research: z.object({ branch: z.enum(['infantry', 'resources', 'training', 'hybrid', 'armored']), targetLevel: integer.min(2).max(8), progressHours: nonnegative, totalHours: finite.positive() }).optional(),
  upkeep: stockpile.optional(), netIncome: stockpile.optional(), coverage: z.record(z.string(), nonnegative).optional(),
  reserveHours: z.record(z.string(), nonnegative.nullable()).optional(), shortages: z.record(z.string(), z.object({ severity: nonnegative, notifiedThreshold: nonnegative })).optional() });
const diplomacyMessage = z.object({ id: z.string(), fromCountryId: integer, toCountryId: integer, body: z.string(), sentAtTick: integer });
const diplomacyProposal = z.object({ id: z.string(), fromCountryId: integer, toCountryId: integer,
  kind: z.enum(['alliance', 'peace']), status: z.enum(['pending', 'accepted', 'declined', 'withdrawn']),
  createdAtTick: integer, resolvedAtTick: integer.optional() });
const outcome = z.object({ result: z.enum(['victory', 'defeat']), reason: z.string(), atGameHours: nonnegative });
const weather = z.object({ mode: z.enum(['automatic', 'forced-clear', 'forced-rain']), raining: z.boolean(),
  scheduleDay: z.string(), rainStartMinute: integer.max(1439), rainDurationMinutes: integer.min(60).max(120) });
export const projectionSchema = z.object({ simulationTick: integer, timeline: timeline.optional(), viewerCountryId: integer,
  startCamera: point.extend({ distance: finite.positive() }), countries: record(country), provinceOwners: record(integer),
  provinceBuildings: record(buildings), provinceActions: record(z.object({
    production: z.array(z.object({ unitTypeId: z.string(), available: z.boolean(), affordable: z.boolean(), reason: z.string().optional() })),
    construction: z.array(z.object({ buildingId, available: z.boolean(), affordable: z.boolean(), targetTier: integer.optional(), reason: z.string().optional() })),
    canSetRally: z.boolean(), rallyReason: z.string().optional(), occupied: z.boolean(),
  })), productionQueues: record(z.array(unitQueue)), constructionQueues: record(z.array(buildingQueue)),
  rallyPoints: record(point.extend({ route: z.array(point).optional() })), armies: record(army),
  provinceEconomies: record(z.unknown()).optional(), resourceNodes: record(resource).optional(),
  ownCountry: ownCountry.nullable(), relations: record(z.enum(['peace', 'allied', 'war'])),
  weather: weather.optional(),
  diplomacy: z.object({ messages: z.array(diplomacyMessage), proposals: z.array(diplomacyProposal) }).optional(),
  outcome: outcome.optional() });
const collectionSchemas = projectionSchema.pick({ countries: true, provinceOwners: true, provinceBuildings: true, provinceActions: true,
  productionQueues: true, constructionQueues: true, rallyPoints: true, armies: true, provinceEconomies: true, relations: true });
const delta = z.object({ changed: projectionSchema.pick({ simulationTick: true, timeline: true, viewerCountryId: true, startCamera: true, ownCountry: true, weather: true, diplomacy: true, outcome: true }).partial(),
  upserts: collectionSchemas.partial(), removals: z.object(Object.fromEntries(Object.keys(collectionSchemas.shape).map((key) => [key, z.array(z.string()).optional()]))),
  redactions: z.array(z.string()) });
const profile = z.object({ soft: nonnegative, light: nonnegative, heavy: nonnegative });
const cost = stockpile.partial();
const catalogs = z.object({ units: z.array(z.object({ id: z.string(), name: z.string(), category: z.enum(['infantry', 'engineer', 'recon', 'armor', 'artillery']),
  armorClass: z.enum(['soft', 'light', 'heavy']), icon: z.string(), maxHp: finite.positive(), speed: nonnegative, attack: profile, defense: profile,
  visionOuter: nonnegative, visionInner: nonnegative, extractionRate: nonnegative, engagementRange: nonnegative, buildCost: cost, buildWork: finite.positive(), upkeep: z.record(z.string(), nonnegative), shortageEffects: z.array(z.unknown()), cost, buildTimeHours: finite.positive(), requiredBuilding: buildingId, stackPriority: finite })),
  buildings: z.array(z.object({ id: buildingId, label: z.string(), kind: z.enum(['military', 'resource']), tiers: z.array(z.unknown()), cost, buildWork: finite.positive(), buildTimeHours: finite.positive() })) });
const eventBase = { id: z.string(), message: z.string().optional() };
const locatedEvent = { ...eventBase, x: finite, z: finite };
const combatCountries = { attacker: integer, defender: integer };
const event = z.discriminatedUnion('kind', [
  z.object({ ...locatedEvent, kind: z.literal('unitCompleted'), ownerCountryId: integer, provinceId: integer, unitTypeId: z.string(), armyId: z.string() }),
  z.object({ ...locatedEvent, kind: z.literal('buildingCompleted'), ownerCountryId: integer, provinceId: integer, buildingId }),
  z.object({ ...locatedEvent, kind: z.literal('capture'), provinceId: integer, fromCountryId: integer, toCountryId: integer }),
  ...(['engaged', 'combatPulse', 'retreat', 'battleEnded'] as const).map((kind) =>
    z.object({ ...locatedEvent, ...combatCountries, kind: z.literal(kind), battleId: z.string(), frontId: z.string() })),
  z.object({ ...locatedEvent, ...combatCountries, kind: z.literal('reinforced'), battleId: z.string(), frontId: z.string(), armyId: z.string() }),
  z.object({ ...locatedEvent, ...combatCountries, kind: z.literal('destroyed'), armyId: z.string(), battleId: z.string().optional(), frontId: z.string().optional() }),
  z.object({ ...locatedEvent, ...combatCountries, kind: z.literal('bombardment'), armyId: z.string(), targetArmyId: z.string() }),
  z.object({ ...locatedEvent, ...combatCountries, kind: z.literal('strike'), provinceId: integer }),
]);
const clock = z.object({
  gameStartedAtEpochMs: finite, gameEpochMs: finite, campaignElapsedSeconds: nonnegative.default(0),
  serverEpochMs: finite, speed: z.literal(1), generation: integer,
  utcOffsetMinutes: z.number().int().min(-840).max(840), timezoneLinked: z.boolean().default(false),
  timeZone: z.string().min(1).max(100).optional(),
});
export const serverMessageSchema: z.ZodType<ServerMessage> = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), gameId: z.string(), gameVersion: z.string(), protocolVersion: z.literal(4), capabilities: z.array(z.string()),
    world: z.object({ version: z.string(), hash: z.string().regex(/^[a-f0-9]{64}$/), assetBaseUrl: z.url(),
      artifactHashes: record(z.string().regex(/^[a-f0-9]{64}$/)) }), countryId: integer, debugEnabled: z.boolean() }),
  z.object({ type: z.literal('baseline'), revision: integer, state: projectionSchema, catalogs, clock }),
  z.object({ type: z.literal('delta'), fromRevision: integer, revision: integer, delta, events: z.array(event) }),
  z.object({ type: z.literal('clockSync'), clock }),
  z.object({ type: z.literal('commandAck'), commandId: z.string(), ok: z.boolean(), appliedRevision: integer.optional(), reason: z.string().optional(), requiredWarCountryIds: z.array(integer).optional() }),
  z.object({ type: z.literal('event'), event }),
  z.object({ type: z.literal('pong'), sentAt: finite, serverEpochMs: finite }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string(), retryable: z.boolean().optional() }),
  z.object({ type: z.literal('devSimSpeed'), multiplier: finite.min(1).max(10_000), devControlsEnabled: z.boolean() }),
  z.object({ type: z.literal('devDiagnostics'), requestedSpeed: finite.min(1).max(10_000), effectiveSpeed: nonnegative,
    pendingSimulationSeconds: nonnegative, lastPumpSteps: integer, lastPumpMilliseconds: nonnegative,
    overloaded: z.boolean(), devControlsEnabled: z.boolean() }),
  z.object({ type: z.literal('devCheatResult'), action: z.enum(['build', 'spawn', 'resource']),
    ok: z.boolean(), message: z.string() }),
]);
