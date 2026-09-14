import { z } from 'zod';
import type { GameState } from './game-state';
import { INITIAL_GAME_EPOCH_MS } from './time';
import { UNIT_TYPE_BY_ID } from './units/unit-catalog';
import { qualifyingPhaseFromBuildings } from './phase';
import { initialTechnologyLevels } from './technology';

const number = z.number().finite();
const positive = number.nonnegative();
const id = z.number().int().nonnegative();
const record = <T extends z.ZodType>(schema: T) => z.record(z.string(), schema);
const point = z.object({ x: number, z: number });
const stockpile = z.object({ funds: positive, manpower: positive, food: positive, stone: positive, metal: positive, oil: positive });
const signedStockpile = z.object({ funds: number, manpower: number, food: number, stone: number, metal: number, oil: number });
const unit = z.string().refine((value) => UNIT_TYPE_BY_ID.has(value), 'Unknown unit type');
const building = z.enum(['barracks', 'tankPlant', 'ordnance', 'missileSite', 'fields', 'quarry', 'mine', 'oilPump']);
const order = z.object({ path: z.array(id), destX: number, destZ: number, intent: z.enum(['move', 'attack']), edgeProgress: positive,
  target: z.discriminatedUnion('kind', [point.extend({ kind: z.literal('position') }),
    z.object({ kind: z.literal('province'), provinceId: id, x: number.optional(), z: number.optional() }),
    z.object({ kind: z.literal('army'), armyId: z.string(), lastKnownX: number, lastKnownZ: number })]).optional() });
const side = z.object({ countryId: id, directionNodeId: id, role: z.enum(['attack', 'defense']), armyIds: z.array(z.string()), entryMaxHpByArmy: record(positive) });
const queue = z.object({ id: z.string(), ownerCountryId: id, progressWork: positive.optional(), totalWork: number.positive().optional(), progressHours: positive.optional(), totalHours: number.positive().optional(), targetTier: id.optional() });
const shortage = z.object({ severity: positive.max(100), notifiedThreshold: z.union([z.literal(0), z.literal(25), z.literal(50), z.literal(75)]) });
const potential = z.object({ food: positive.max(1), stone: positive.max(1), metal: positive.max(1), oil: positive.max(1) });
const technologyBranch = z.enum(['infantry', 'resources', 'training', 'hybrid', 'armored']);
const technologyLevelsSchema = z.object({ infantry: id.min(1).max(8), resources: id.min(1).max(8), training: id.min(1).max(8), hybrid: id.min(1).max(8), armored: id.min(1).max(8) });
const research = z.object({ branch: technologyBranch, targetLevel: id.min(2).max(8), progressHours: positive, totalHours: number.positive() });
const resourceBuildings = z.object({ fields: id.max(8), quarry: id.max(8), mine: id.max(8), oilPump: id.max(8) });
const stateSchema = z.object({ version: z.literal(4), seed: number, scenarioId: z.string(), mode: z.enum(['campaign', 'sandbox']),
  fogOfWar: z.boolean(), economyEnabled: z.boolean(),
  clock: z.object({
    gameTimeHours: positive, startDate: z.string(),
    initialEpochMs: number.min(-8.64e15).max(8.64e15).optional(), generation: id.optional(), pendingHours: positive.optional(),
    cadence: z.object({ incomeHours: positive, supplyHours: positive, aiHours: positive }).optional(),
    visualEpochMs: number.min(-8.64e15).max(8.64e15).optional(),
    visualAnchorRealEpochMs: number.min(-8.64e15).max(8.64e15).optional(),
    visualUtcOffsetMinutes: number.int().min(-840).max(840).optional(),
    visualTimeZone: z.string().min(1).max(100).optional(),
    visualTimezoneLinked: z.boolean().optional(),
    visualGeneration: id.optional(),
  }),
  weather: z.object({
    mode: z.enum(['automatic', 'forced-clear', 'forced-rain']), raining: z.boolean(),
    scheduleDay: z.string(), rainStartMinute: id.max(1439), rainDurationMinutes: id.min(60).max(120),
  }).optional(),
  simulationTick: id,
  countries: record(z.object({ id, name: z.string(), color: z.string(), controller: z.enum(['player', 'ai', 'neutral']), stockpile, income: stockpile, industryCapacity: positive, upkeep: stockpile.optional(), netIncome: signedStockpile.optional(), coverage: z.object({ funds: positive.max(1), food: positive.max(1), metal: positive.max(1), oil: positive.max(1) }).optional(), reserveHours: z.object({ funds: positive.nullable(), food: positive.nullable(), metal: positive.nullable(), oil: positive.nullable() }).optional(), shortages: z.object({ funds: shortage, food: shortage, metal: shortage, oil: shortage }).optional(), warheads: positive.default(0), phase: id.optional(), technologies: technologyLevelsSchema.optional(), research: research.optional() })),
  provinceOwners: record(id), provinceBuildings: record(z.object({ barracks: id.max(8), tankPlant: id.max(8), ordnance: id.max(8), missileSite: id.max(8).default(0) })),
  productionQueues: record(z.array(queue.extend({ unitTypeId: unit }))), constructionQueues: record(z.array(queue.extend({ buildingId: building }))), rallyPoints: record(point),
  armies: record(point.extend({ id: z.string(), ownerCountryId: id, name: z.string(), graphNodeId: id,
    edge: z.object({ from: id, to: id }).nullable().optional(),
    units: z.array(z.object({ typeId: unit, count: id, hp: positive, experience: positive })), status: z.enum(['idle', 'moving', 'engaged', 'retreating', 'extracting', 'embarking', 'atSea', 'disembarking']), order: order.nullable(), extractingNodeId: id.nullable(), extractionAssignment: z.object({ provinceId: id, resource: z.enum(['food', 'stone', 'metal', 'oil']) }).nullable().optional(), shortageSeverity: z.object({ funds: positive.max(100), food: positive.max(100), metal: positive.max(100), oil: positive.max(100) }).optional(),
    lastGraphNodeId: id.nullable().optional(), suspendedOrder: order.nullable().optional(), battleFrontIds: z.array(z.string()).optional(),
    retreat: z.object({ destinationProvinceId: id, protectedUntilNodeId: id, protected: z.boolean() }).nullable().optional(),
    artillery: z.object({ targetArmyId: z.string().nullable(), manualTarget: z.boolean() }).optional(),
    navalCrossing: z.object({ fromNodeId: id, toNodeId: id, hoursRemaining: positive }).nullable().default(null),
    organization: positive.optional(), entrenchment: positive.optional(),
    stance: z.enum(['attack', 'attack-defend', 'defend', 'defend-retreat', 'retreat']).optional(),
    inSupply: z.boolean().optional() })),
  battles: record(z.object({ id: z.string(), frontIds: z.array(z.string()) })),
  battleFronts: record(point.extend({ id: z.string(), battleId: z.string(), anchorNodeId: id, kind: z.enum(['road', 'province']), provinceId: id.nullable(), sideA: side, sideB: side })),
  resourceNodes: record(point.extend({ id, kind: z.enum(['stone', 'metal', 'oil']), remaining: positive, initialAmount: positive, controllerCountryId: id,
    provinceId: z.number().int(), accessNodeId: z.number().int(), extractorArmyId: z.string().nullable(), status: z.enum(['idle', 'secured', 'extracting', 'exhausted']), provenance: z.enum(['generatedNatural', 'scenarioGuarantee']) })),
  provinceEconomies: record(z.object({ resourcePotential: potential, baseProduction: stockpile, resourceBuildings,
    productionCapacity: number.positive(), constructionCapacity: number.positive(), normalizedOpeningSites: z.array(z.enum(['food', 'stone', 'metal', 'oil'])).optional() })).default({}),
  relations: record(z.enum(['peace', 'allied', 'war'])),
  provinceDevastation: record(positive).default({}),
  outcome: z.object({ result: z.enum(['victory', 'defeat']), reason: z.string(), atGameHours: positive }).optional(),
  diplomacyMessages: record(z.object({ id: z.string(), fromCountryId: id, toCountryId: id, body: z.string(), sentAtTick: id })).default({}),
  diplomacyProposals: record(z.object({ id: z.string(), fromCountryId: id, toCountryId: id, kind: z.enum(['alliance', 'peace']), status: z.enum(['pending', 'accepted', 'declined', 'withdrawn']), createdAtTick: id, resolvedAtTick: id.optional() })).default({}),
  nextDiplomacyId: id.default(1), nextArmyId: id, nextBattleId: id, nextFrontId: id.optional(), nextOrderId: id, nextEventId: id,
});

/** V4 is a deliberate reset; older snapshots are rejected by the ruleset gate. */
export function parseGameState(input: unknown, initialEpochMs = INITIAL_GAME_EPOCH_MS): GameState {
  const parsed = stateSchema.parse(input);
  parsed.clock.initialEpochMs ??= initialEpochMs;
  parsed.clock.generation ??= 0;
  parsed.clock.cadence ??= { incomeHours: 0, supplyHours: 0, aiHours: 0 };
  parsed.clock.visualGeneration ??= 0;
  parsed.nextFrontId ??= 1;
  parsed.provinceDevastation ??= {};
  parsed.diplomacyMessages ??= {};
  parsed.diplomacyProposals ??= {};
  parsed.nextDiplomacyId ??= 1;
  for (const country of Object.values(parsed.countries)) {
    country.warheads ??= 0;
    country.upkeep ??= { funds: 0, manpower: 0, food: 0, stone: 0, metal: 0, oil: 0 };
    country.netIncome ??= { ...country.income };
    country.coverage ??= { funds: 1, food: 1, metal: 1, oil: 1 };
    country.reserveHours ??= { funds: null, food: null, metal: null, oil: null };
    country.shortages ??= {
      funds: { severity: 0, notifiedThreshold: 0 }, food: { severity: 0, notifiedThreshold: 0 },
      metal: { severity: 0, notifiedThreshold: 0 }, oil: { severity: 0, notifiedThreshold: 0 },
    };
    // Computed from buildings already owned, not defaulted to 1 — an existing
    // save with an Ordnance Workshop or Missile Site must not be retroactively
    // locked out of what it already has.
    country.phase ??= qualifyingPhaseFromBuildings(parsed as unknown as GameState, country.id);
    country.technologies ??= initialTechnologyLevels();
  }
  for (const buildings of Object.values(parsed.provinceBuildings)) buildings.missileSite ??= 0;
  for (const army of Object.values(parsed.armies)) {
    army.navalCrossing ??= null;
    army.organization ??= 100;
    army.entrenchment ??= 0;
    army.stance ??= 'attack-defend';
    army.inSupply ??= true;
    const types = new Set<string>();
    for (const group of army.units) {
      if (!group.count || !group.hp || group.hp > group.count * UNIT_TYPE_BY_ID.get(group.typeId)!.maxHp + 1e-6 || types.has(group.typeId)) throw new Error('Invalid army composition.');
      types.add(group.typeId);
    }
    if (!parsed.countries[army.ownerCountryId] || army.units.length === 0) throw new Error('Invalid army owner or empty army.');
  }
  for (const [key, country] of Object.entries(parsed.countries)) if (String(country.id) !== key) throw new Error('Country key mismatch.');
  for (const [key, army] of Object.entries(parsed.armies)) if (army.id !== key) throw new Error('Army key mismatch.');
  for (const owner of Object.values(parsed.provinceOwners)) if (owner !== 0 && !parsed.countries[owner]) throw new Error('Unknown province owner.');
  return { ...parsed, version: 4 } as GameState;
}
