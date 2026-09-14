/**
 * Strategic AI v2 ("IMPORTANT AI RULE").
 *
 * AI-controlled countries go through the SAME `applyCommand` boundary the
 * player does (with their own countryId) — never direct state edits, and never
 * a `confirmedWarCountryIds` field, which is what keeps the AI from declaring
 * opportunistic wars: any order whose route needs a fresh war is simply
 * refused.
 *
 * One pass per country, strict priority order, at most one order per concern so
 * armies never thrash:
 *   1. pull a broken stack out of a battle it is losing
 *   2. relieve the capital / a threatened city
 *   3. work a controlled deposit with an idle miner
 *   4. queue a unit  5. queue a building
 *   6. gather loose stacks at one staging province (they merge on arrival)
 *   7. assault, but only with local superiority
 *   8. a rate-limited strategic strike
 *   9. peace when losing a multi-front war
 * Steps 6-9 are war-only; a country at peace just defends and builds.
 */

import type { SimContext } from '../sim-context';
import { applyCommand } from '../commands';
import { producibleUnits } from '../production';
import { BUILDINGS, buildOptions, buildableBuildings } from '../construction';
import { stackHealthFraction, type ArmyStack } from '../units/army';
import { baseUnitId, unitType } from '../units/unit-catalog';
import type { BuildingId } from '../units/unit-types';
import type { WorldProvince } from '../world-data';
import { wrappedDistance } from '../geometry';
import { nearestNode } from '../movement/graph';
import type { CountryState, PhysicalResource, ResourceBuildingId, UpkeepResource } from '../game-state';
import { engineersAssignedTo } from '../economy/resource-production';
import {
  BUILDING_FOR_RESOURCE, effectiveEngineerCount, RESOURCE_TIER_ENGINEER_CAP,
  RESOURCE_TIER_ENGINEER_MULTIPLIER,
} from '../economy/resources';
import {
  CONTACT_RADIUS, aiMemory, assess, combatStrength, indexArmies, indexProvinces,
  provinceNode, strengthNear, type AiMemory, type Assessment, type CityStatus,
} from './assessment';

/** A threatened city keeps this much more weight than is bearing down on it. */
const DEFENCE_MARGIN = 1.5;
/** ~3 infantry: the token the capital always keeps back. */
const MIN_GARRISON_STRENGTH = 300;
/** Enemy weight counted around an engaged stack when judging the battle. */
const MELEE_RADIUS = 150;
/** Break off below this share of full hp... */
const RETREAT_HEALTH = 0.35;
/** ...or below this share of the enemy weight pressing us. */
const RETREAT_RATIO = 0.6;
/** Never let a province sit on more than this many queued units. */
const MAX_QUEUED_UNITS = 2;
/** A city this close to the front builds to fight, not to industrialise. */
const FRONTLINE_RADIUS = 1200;
/** Move orders spent gathering the loose stacks in one pass. */
const STAGING_ORDERS_PER_PASS = 2;
/** Reinforce distinct pressed fronts in one pass instead of feeding one axis. */
const FRONT_REINFORCEMENT_ORDERS_PER_PASS = 2;
/** Attack only with this much more weight than the local defence. */
const COMMIT_RATIO = 1.5;
/** ~4 infantry at full strength: below this a stack stages, it does not attack. */
const MIN_ASSAULT_STRENGTH = 400;
/** How far the spearhead will reach for an isolated enemy stack. */
const OPPORTUNITY_RADIUS = 900;
/** Objectives to try before giving up for this pass (skips unreachable ground). */
const OBJECTIVE_TRIES = 3;
/**
 * Missile Site reach. Re-declared from `src/game/strike.ts`, where it is
 * deliberately module-private — keep the two in step if that one is retuned.
 */
const MISSILE_RANGE = 3200;
/** Preserve the prototype's ten-day strike pacing on the 1:1 timeline. */
const STRIKE_COOLDOWN_HOURS = 240;
/** Preserve the prototype's two-week peace-offer pacing on the 1:1 timeline. */
const PEACE_OFFER_COOLDOWN_HOURS = 336;
/** Wars being fought at once before peace looks better than pride. */
const MULTI_FRONT_WARS = 3;

export function stepAi(session: SimContext, _dtHours: number): void {
  const state = session.state;
  const aiCountries = Object.values(state.countries).filter((c) => c.controller === 'ai');
  if (aiCountries.length === 0) return;

  const memory = aiMemory(state);
  const armiesByOwner = indexArmies(state);
  const provincesByOwner = indexProvinces(session);

  for (const country of aiCountries) {
    const situation = assess(session, memory, country.id, armiesByOwner, provincesByOwner);
    retreatBrokenStack(session, situation);
    defendCities(session, situation);
    workDeposits(session, situation);
    developResources(session, situation);
    produceUnits(session, situation);
    buildIndustry(session, situation);
    if (!situation.atWar) continue;
    mobilise(session, memory, situation);
    reinforceThreatenedFronts(session, situation);
    const recapturing = recaptureLostTerritory(session, situation);
    if (recapturing) {
      strategicStrike(session, memory, situation);
      negotiate(session, memory, situation);
      continue;
    }
    concentrate(session, memory, situation);
    assault(session, memory, situation);
    strategicStrike(session, memory, situation);
    negotiate(session, memory, situation);
  }
}

interface EconomyAiSituation {
  countryId: number;
  armies: readonly ArmyStack[];
  cities: ReadonlyArray<{ province: WorldProvince }>;
}

/** Lightweight economic slice of the live AI, shared with long-running
 * balance simulations so those tests do not pay for combat-front assessment. */
export function stepAiEconomy(session: SimContext, countryIds?: readonly number[]): void {
  const selected = countryIds ? new Set(countryIds) : null;
  for (const country of Object.values(session.state.countries)) {
    if (country.controller !== 'ai' || (selected && !selected.has(country.id))) continue;
    const situation: EconomyAiSituation = {
      countryId: country.id,
      armies: Object.values(session.state.armies).filter((army) => army.ownerCountryId === country.id),
      cities: session.world.provinces.filter((province) => province.urban
        && session.state.provinceOwners[province.id] === country.id).map((province) => ({ province })),
    };
    workDeposits(session, situation);
    developResources(session, situation);
    produceUnits(session, situation);
  }
}

/** Send one available reserve to each of the worst outmatched active fronts. */
function reinforceThreatenedFronts(session: SimContext, situation: Assessment): void {
  const available = availableStacks(situation);
  let issued = 0;
  for (const front of situation.threatenedFronts) {
    const reserve = available
      .sort((a, b) => wrappedDistance(a.x, a.z, front.x, front.z, session.world.width)
        - wrappedDistance(b.x, b.z, front.x, front.z, session.world.width))[0];
    if (!reserve) return;
    const done = applyCommand(session, {
      type: 'moveArmy', countryId: situation.countryId, armyId: reserve.id,
      x: front.x, z: front.z,
    }).ok;
    if (!done) continue;
    available.splice(available.indexOf(reserve), 1);
    if ((issued += 1) >= FRONT_REINFORCEMENT_ORDERS_PER_PASS) return;
  }
}

/** Retake national territory before extending the war into a new objective. */
function recaptureLostTerritory(session: SimContext, situation: Assessment): boolean {
  if (!situation.lostProvinces.length) return false;
  const spearheads = availableStacks(situation).sort((a, b) => combatStrength(b) - combatStrength(a));
  for (const spearhead of spearheads) {
    const strength = combatStrength(spearhead);
    if (strength < MIN_ASSAULT_STRENGTH) continue;
    const objectives = situation.lostProvinces.slice().sort((a, b) => wrappedDistance(
      spearhead.x, spearhead.z, a.center[0], a.center[1], session.world.width,
    ) - wrappedDistance(
      spearhead.x, spearhead.z, b.center[0], b.center[1], session.world.width,
    ));
    for (const province of objectives) {
      if (strength < oppositionTo(situation, spearhead, province, session.world.width) * COMMIT_RATIO) continue;
      if (applyCommand(session, {
        type: 'attackArmy', countryId: situation.countryId, armyId: spearhead.id,
        target: { kind: 'province', provinceId: province.id },
      }).ok) return true;
    }
  }
  return false;
}

/**
 * What a city must keep back: cover for whatever is bearing down on it, a token
 * force at the capital whatever the map looks like, and nothing at all at a
 * quiet rear city — a province no one is near does not tie down a field army.
 */
function requiredGarrison(city: CityStatus): number {
  if (city.threatStrength > 0) {
    return Math.max(city.threatStrength * DEFENCE_MARGIN, MIN_GARRISON_STRENGTH);
  }
  return city.isCapital ? MIN_GARRISON_STRENGTH : 0;
}

/**
 * Stacks free to be given a new job. A stack standing on one of our cities may
 * only leave if the city still covers the threat against it once he is gone —
 * so the last defender of the capital or of a pressed city is never stripped,
 * while a garrison sitting on ten times what it needs is not frozen either.
 * Strengths are re-read live, so a split earlier in this pass counts.
 */
function availableStacks(situation: Assessment): ArmyStack[] {
  const spareByNode = new Map<number, number>();
  for (const city of situation.cities) {
    let held = 0;
    for (const army of city.garrison) held += combatStrength(army);
    const spare = held - requiredGarrison(city);
    spareByNode.set(city.node, Math.min(spareByNode.get(city.node) ?? Infinity, spare));
  }
  return situation.armies.filter((army) => {
    if (army.order || army.status !== 'idle' || army.extractingNodeId !== null) return false;
    const strength = combatStrength(army);
    if (strength <= 0) return false;
    const spare = spareByNode.get(army.graphNodeId);
    return spare === undefined || strength <= spare;
  });
}

/** 1. A stack that is losing its battle walks back into friendly territory. */
function retreatBrokenStack(session: SimContext, situation: Assessment): void {
  for (const army of situation.armies) {
    if (army.status !== 'engaged' || !army.battleFrontIds?.length) continue;
    const pressure = strengthNear(
      situation.enemyArmies, army.x, army.z, MELEE_RADIUS, session.world.width,
    );
    if (stackHealthFraction(army) >= RETREAT_HEALTH
      && combatStrength(army) >= pressure * RETREAT_RATIO) continue;
    // `retreatArmy` picks the adjacent road node best aimed at the point we
    // give it, so aim exactly at the exit we want. Two candidates at most:
    // each attempt re-plans every friendly escape route and is not cheap.
    for (const exit of escapeNodes(session, situation, army).slice(0, 2)) {
      const done = applyCommand(session, {
        type: 'retreatArmy', countryId: situation.countryId, armyId: army.id,
        x: session.graph.nodeX[exit], z: session.graph.nodeZ[exit],
      }).ok;
      if (done) return;
    }
    return;
  }
}

/** Neighbouring road nodes that do not face the enemy, homeward first. */
function escapeNodes(
  session: SimContext, situation: Assessment, army: ArmyStack,
): number[] {
  const battleIds = new Set(
    (army.battleFrontIds ?? []).map((id) => session.state.battleFronts[id]?.battleId),
  );
  const facingEnemy = new Set<number>();
  for (const front of Object.values(session.state.battleFronts)) {
    if (!battleIds.has(front.battleId)) continue;
    for (const side of [front.sideA, front.sideB]) {
      if (side.countryId !== situation.countryId) facingEnemy.add(side.directionNodeId);
    }
  }
  const homeDistance = (node: number): number => {
    let best = Infinity;
    for (const province of situation.provinces) {
      best = Math.min(best, wrappedDistance(
        session.graph.nodeX[node], session.graph.nodeZ[node],
        province.center[0], province.center[1], session.world.width,
      ));
    }
    return best;
  };
  return (session.graph.adjacency[army.graphNodeId] ?? [])
    .filter((node) => !facingEnemy.has(node))
    .sort((a, b) => homeDistance(a) - homeDistance(b));
}

/** 2. Send the nearest spare stack to the worst-held city (capital first). */
function defendCities(session: SimContext, situation: Assessment): void {
  const available = availableStacks(situation);
  if (available.length === 0) return;
  for (const city of situation.cities) {
    if (city.threatStrength <= city.garrisonStrength) continue;
    const relief = available
      .filter((army) => army.graphNodeId !== city.node)
      .sort((a, b) => wrappedDistance(
        a.x, a.z, city.province.center[0], city.province.center[1], session.world.width,
      ) - wrappedDistance(
        b.x, b.z, city.province.center[0], city.province.center[1], session.world.width,
      ))[0];
    if (!relief) continue;
    const done = applyCommand(session, {
      type: 'moveArmy', countryId: situation.countryId, armyId: relief.id,
      x: city.province.center[0], z: city.province.center[1],
    }).ok;
    if (done) return;
  }
}

/** 3. Put one idle engineer stack on a useful renewable province resource. */
function workDeposits(
  session: SimContext, situation: Pick<EconomyAiSituation, 'countryId' | 'armies'>,
): void {
  const country = session.state.countries[situation.countryId];
  const priorities = (['food', 'metal', 'oil', 'stone'] as PhysicalResource[]).sort((a, b) =>
    ((country.coverage?.[a as 'food' | 'metal' | 'oil'] ?? 1) - (country.coverage?.[b as 'food' | 'metal' | 'oil'] ?? 1)));
  const sites = session.world.provinces.flatMap((province) => {
    if (session.state.provinceOwners[province.id] !== situation.countryId) return [];
    const economy = session.state.provinceEconomies?.[province.id];
    if (!economy) return [];
    return priorities.flatMap((resource) => economy.baseProduction[resource] > 0
      ? [{ province, resource, economy }] : []);
  });
  if (!sites.length) return;
  for (const army of situation.armies) {
    if (army.order || army.status !== 'idle' || army.extractionAssignment !== null) continue;
    if (!army.units.some((group) => baseUnitId(group.typeId) === 'engineer' && group.count > 0)) continue;
    const incoming = army.units.filter((group) => baseUnitId(group.typeId) === 'engineer').reduce((sum, group) => sum + group.count, 0);
    const target = sites.map((site) => {
      const building = BUILDING_FOR_RESOURCE[site.resource];
      const tier = site.economy.resourceBuildings[building];
      const cap = RESOURCE_TIER_ENGINEER_CAP[tier];
      const assigned = engineersAssignedTo(session, site.province.id, site.resource);
      const marginal = (effectiveEngineerCount(assigned + incoming, cap) - effectiveEngineerCount(assigned, cap))
        * RESOURCE_TIER_ENGINEER_MULTIPLIER[tier];
      const coverage = site.resource === 'stone' ? 1 : country.coverage?.[site.resource] ?? 1;
      const distance = wrappedDistance(army.x, army.z, site.province.center[0], site.province.center[1], session.world.width);
      return { ...site, score: marginal * (2.2 - Math.min(1, coverage)) * (0.7 + site.economy.resourcePotential[site.resource])
        / (1 + distance / 2_500) };
    }).sort((a, b) => b.score - a.score)[0];
    if (!target || target.score <= 0.01) continue;
    const targetNode = nearestNode(session.graph, target.province.center[0], target.province.center[1]);
    applyCommand(session, army.graphNodeId === targetNode
      ? { type: 'extract', countryId: situation.countryId, armyId: army.id, resource: target.resource }
      : {
        type: 'moveArmy', countryId: situation.countryId, armyId: army.id,
        x: target.province.center[0], z: target.province.center[1],
      });
    return;
  }
}

/** Develop renewable rural sites before expanding the army. Marginal passive
 * output, engineer headroom, pressure, work, and total recipe burden all feed
 * the same score; queued prerequisites are already reflected by buildOptions. */
function developResources(session: SimContext, situation: Pick<EconomyAiSituation, 'countryId'>): void {
  const country = session.state.countries[situation.countryId];
  if (!country) return;
  const candidates: Array<{ provinceId: number; buildingId: ResourceBuildingId; score: number }> = [];
  for (const province of session.world.provinces) {
    if (province.urban || session.state.provinceOwners[province.id] !== situation.countryId) continue;
    if ((session.state.constructionQueues[province.id]?.length ?? 0) >= 2) continue;
    const economy = session.state.provinceEconomies?.[province.id];
    if (!economy) continue;
    for (const option of buildOptions(session, province.id, situation.countryId)) {
      if (option.reason || !option.affordable || !['fields', 'quarry', 'mine', 'oilPump'].includes(option.id)) continue;
      const buildingId = option.id as ResourceBuildingId;
      const resource = ({ fields: 'food', quarry: 'stone', mine: 'metal', oilPump: 'oil' } as const)[buildingId];
      const recipe = BUILDINGS[buildingId].tiers[option.targetTier - 1];
      if (!recipe) continue;
      const priorPassive = [0, 2, 5, 12, 20, 32][option.targetTier - 1] ?? 0;
      const nextPassive = [0, 2, 5, 12, 20, 32][option.targetTier] ?? priorPassive;
      const pressure = resource === 'stone' ? 1 : 1 + (1 - (country.coverage?.[resource] ?? 1)) * 4
        + (country.shortages?.[resource]?.severity ?? 0) / 25;
      const costBurden = Object.values(recipe.cost).reduce((sum, value) => sum + (value ?? 0), 0) / 500;
      const score = (nextPassive - priorPassive + option.targetTier * 0.6)
        * (0.5 + economy.resourcePotential[resource]) * pressure / (recipe.work + costBurden);
      candidates.push({ provinceId: province.id, buildingId, score });
    }
  }
  const pick = candidates.sort((a, b) => b.score - a.score)[0];
  if (pick) applyCommand(session, { type: 'build', countryId: situation.countryId,
    provinceId: pick.provinceId, buildingId: pick.buildingId });
}

/** 4. One unit order per pass, at the most pressed city that can take it. */
function produceUnits(session: SimContext, situation: EconomyAiSituation): void {
  const country = session.state.countries[situation.countryId];
  if (!country) return;
  const miners = situation.armies.filter((army) => army.units.some((group) => baseUnitId(group.typeId) === 'engineer' && group.count > 0)).length;
  for (const city of situation.cities) {
    const provinceId = city.province.id;
    if ((session.state.productionQueues[provinceId]?.length ?? 0) >= MAX_QUEUED_UNITS) continue;
    const options = producibleUnits(session, provinceId, situation.countryId);
    const pick = chooseUnit(country, options, miners);
    if (!pick) continue;
    const done = applyCommand(session, {
      type: 'produce', countryId: situation.countryId, provinceId, unitTypeId: pick,
    }).ok;
    if (done) return;
  }
}

/**
 * Cheap infantry is the staple; armour only once the metal really covers it.
 *
 * Funds/food thresholds sit at roughly 1.5-2x the unit's actual cost (see
 * unit-catalog.ts) — enough headroom that a passing gate always affords the
 * unit outright, without starving the AI the way a leftover 3-4x buffer sized
 * for the old, much cheaper costs would against the current, slower economy.
 * Metal/oil/manpower gates are untouched: those costs did not change.
 */
function chooseUnit(
  country: CountryState,
  options: readonly string[], miners: number,
): string | null {
  const stockpile = country.stockpile;
  const option = (family: string): string | undefined => options.find((id) => baseUnitId(id) === family);
  const sustainable = (unitId: string): boolean => {
    const upkeep = unitType(unitId).upkeep;
    return (['funds', 'food', 'metal', 'oil'] as UpkeepResource[]).every((resource) => {
      const projectedDemand = (country.upkeep?.[resource] ?? 0) + (upkeep[`${resource}PerHour` as keyof typeof upkeep] ?? 0);
      const deficit = projectedDemand - (country.income[resource] ?? 0);
      return deficit <= 0 || country.stockpile[resource] / deficit >= 72;
    });
  };
  const engineer = option('engineer');
  const mediumTank = option('medium-tank');
  const lightTank = option('light-tank');
  const artillery = option('artillery');
  const infantry = option('infantry');
  if (miners < 2 && engineer
    && stockpile.funds > 120 && stockpile.manpower > 80 && sustainable(engineer)) return engineer;
  if (mediumTank
    && stockpile.metal > 400 && stockpile.oil > 200
    && stockpile.funds > 3_600 && stockpile.food > 675 && sustainable(mediumTank)) return mediumTank;
  if (lightTank
    && stockpile.metal > 220 && stockpile.oil > 120
    && stockpile.funds > 2_000 && stockpile.food > 450 && sustainable(lightTank)) return lightTank;
  if (artillery
    && stockpile.metal > 200 && stockpile.funds > 220 && sustainable(artillery)) return artillery;
  if (infantry
    && stockpile.manpower > 120 && stockpile.funds > 400 && stockpile.food > 150 && sustainable(infantry)) return infantry;
  return null;
}

/** 5. Frontline cities build to fight; rear cities industrialise. */
function buildIndustry(session: SimContext, situation: Assessment): void {
  for (const city of situation.cities) {
    const provinceId = city.province.id;
    if ((session.state.constructionQueues[provinceId]?.length ?? 0) >= 1) continue;
    const options = buildableBuildings(session, provinceId, situation.countryId);
    if (options.length === 0) continue;
    const frontline = city.threatStrength > 0 || (situation.frontTarget !== null
      && wrappedDistance(
        city.province.center[0], city.province.center[1],
        situation.frontTarget.center[0], situation.frontTarget.center[1], session.world.width,
      ) < FRONTLINE_RADIUS);
    const order: BuildingId[] = frontline
      ? ['barracks', 'ordnance', 'tankPlant', 'missileSite']
      : ['tankPlant', 'ordnance', 'barracks', 'missileSite'];
    const pick = order.find((id) => options.includes(id));
    if (!pick) continue;
    const done = applyCommand(session, {
      type: 'build', countryId: situation.countryId, provinceId, buildingId: pick,
    }).ok;
    if (done) return;
  }
}

/**
 * 6a. Mobilise. A country whose whole army IS its capital garrison can never
 * free a stack the normal way — the stack is worth more than the city can
 * spare. Split the surplus off instead: the covering garrison stays put and the
 * field army marches. Without this a small nation just sat on its capital.
 */
function mobilise(session: SimContext, memory: AiMemory, situation: Assessment): void {
  const staging = situation.staging;
  if (!staging) return;
  const stagingNode = provinceNode(session, memory, staging);
  for (const city of situation.cities) {
    let held = 0;
    for (const army of city.garrison) held += combatStrength(army);
    const spare = held - requiredGarrison(city);
    if (spare < MIN_ASSAULT_STRENGTH) continue;
    // Only stacks too big to march off on their own need cutting down.
    const parent = city.garrison.find((army) => !army.order && army.status === 'idle'
      && army.extractingNodeId === null && combatStrength(army) > spare);
    if (!parent) continue;
    // A city that IS the staging point cannot march a detachment to itself, so
    // aim that one at the front — but only when the detachment on its own
    // beats everything in the way, which is the same gate `assault` applies.
    const marchOut = city.node === stagingNode;
    const destination = marchOut ? situation.frontTarget : staging;
    if (!destination) continue;
    if (marchOut && spare < oppositionTo(
      situation, parent, destination, session.world.width,
    ) * COMMIT_RATIO) continue;
    const groups = detachment(parent, spare);
    if (groups.length === 0) continue;
    const done = applyCommand(session, {
      type: 'splitArmy', countryId: situation.countryId, armyId: parent.id,
      groups, x: destination.center[0], z: destination.center[1],
    }).ok;
    if (done) return;
  }
}

/** Up to `budget` worth of fighting units; engineers stay home and mine. */
function detachment(
  stack: ArmyStack, budget: number,
): { typeId: string; count: number }[] {
  const groups: { typeId: string; count: number }[] = [];
  let remaining = budget;
  for (const group of stack.units) {
    if (group.count <= 0 || unitType(group.typeId).category === 'engineer') continue;
    const perUnit = group.hp / group.count;
    const take = Math.min(group.count, Math.floor(remaining / Math.max(perUnit, 1)));
    if (take <= 0) continue;
    groups.push({ typeId: group.typeId, count: take });
    remaining -= take * perUnit;
  }
  return groups;
}

/**
 * 6b. Gather. Loose stacks march on ONE staging province behind the front, where
 * `stepMovement` folds arrivals into the stack already resting there — so the
 * country builds a fist instead of feeding the enemy one stack at a time. Rear
 * cities rally their production to the same point.
 */
function concentrate(session: SimContext, memory: AiMemory, situation: Assessment): void {
  const staging = situation.staging;
  if (!staging) return;
  const stagingNode = provinceNode(session, memory, staging);
  let issued = 0;
  for (const army of availableStacks(situation)) {
    if (army.graphNodeId === stagingNode) continue;
    const done = applyCommand(session, {
      type: 'moveArmy', countryId: situation.countryId, armyId: army.id,
      x: staging.center[0], z: staging.center[1],
    }).ok;
    if (done && (issued += 1) >= STAGING_ORDERS_PER_PASS) break;
  }
  for (const city of situation.cities) {
    if (city.province.id === staging.id || city.threatStrength > 0) continue;
    const rally = session.state.rallyPoints[city.province.id];
    if (rally && rally.x === staging.center[0] && rally.z === staging.center[1]) continue;
    const done = applyCommand(session, {
      type: 'setRally', countryId: situation.countryId, provinceId: city.province.id,
      target: { x: staging.center[0], z: staging.center[1] },
    }).ok;
    if (done) return;
  }
}

/**
 * 7. Commit the massed stack — an isolated enemy first, then enemy ground.
 *
 * The candidate pool used to be every available stack anywhere, so a single
 * freshly-idle detachment on the frontier could get thrown in solo the moment
 * it crossed MIN_ASSAULT_STRENGTH, before `concentrate` had a chance to gather
 * it with the rest of the army — reading as small, repeated attacks ("spam")
 * instead of one committed force. Once a staging point exists, only stacks
 * that have actually arrived there are eligible, so this only ever fires the
 * fist `concentrate` built.
 */
function assault(session: SimContext, memory: AiMemory, situation: Assessment): void {
  const staging = situation.staging;
  const stagingNode = staging ? provinceNode(session, memory, staging) : null;
  const spearhead = availableStacks(situation)
    .filter((army) => stagingNode === null || army.graphNodeId === stagingNode)
    .sort((a, b) => combatStrength(b) - combatStrength(a))[0];
  if (!spearhead) return;
  const strength = combatStrength(spearhead);
  if (strength < MIN_ASSAULT_STRENGTH) return;
  const width = session.world.width;

  const prey = situation.enemyArmies
    .filter((enemy) => combatStrength(enemy) * COMMIT_RATIO < strength)
    .map((enemy) => ({
      enemy, distance: wrappedDistance(spearhead.x, spearhead.z, enemy.x, enemy.z, width),
    }))
    .filter((candidate) => candidate.distance < OPPORTUNITY_RADIUS)
    .sort((a, b) => a.distance - b.distance)[0];
  if (prey) {
    const done = applyCommand(session, {
      type: 'attackArmy', countryId: situation.countryId, armyId: spearhead.id,
      target: { kind: 'army', armyId: prey.enemy.id },
    }).ok;
    if (done) return;
  }

  const objectives = situation.enemyProvinces
    .map((province) => ({
      province,
      score: wrappedDistance(
        spearhead.x, spearhead.z, province.center[0], province.center[1], width,
      ) * (situation.enemyCapitals.has(province.id) ? 0.6 : 1),
    }))
    .sort((a, b) => a.score - b.score);
  let tried = 0;
  for (const { province } of objectives) {
    if (strength < oppositionTo(situation, spearhead, province, width) * COMMIT_RATIO) continue;
    // No aim point: `issueAttack` then marches on the province centre without a
    // point-in-province check, and reports failure for ground we cannot reach.
    const done = applyCommand(session, {
      type: 'attackArmy', countryId: situation.countryId, armyId: spearhead.id,
      target: { kind: 'province', provinceId: province.id },
    }).ok;
    if (done || (tried += 1) >= OBJECTIVE_TRIES) return;
  }
}

/**
 * Enemy weight standing in the way of an assault: whatever holds the objective,
 * plus every stack between us and it. A province that looks undefended because
 * it sits behind an intact enemy field army is not undefended, and marching a
 * column past that army to reach it is how the old AI lost its stacks.
 */
function oppositionTo(
  situation: Assessment, from: ArmyStack, target: WorldProvince, width: number,
): number {
  const reach = wrappedDistance(from.x, from.z, target.center[0], target.center[1], width);
  let total = 0;
  for (const enemy of situation.enemyArmies) {
    const toObjective = wrappedDistance(
      enemy.x, enemy.z, target.center[0], target.center[1], width,
    );
    const toUs = wrappedDistance(from.x, from.z, enemy.x, enemy.z, width);
    if (toObjective > CONTACT_RADIUS && (toUs > reach || toObjective > reach)) continue;
    total += combatStrength(enemy);
  }
  return total;
}

/** 8. One warhead at the most valuable reachable enemy province, rarely. */
function strategicStrike(
  session: SimContext, memory: AiMemory, situation: Assessment,
): void {
  const country = session.state.countries[situation.countryId];
  if (!country || (country.warheads ?? 0) < 1) return;
  const now = session.state.clock.gameTimeHours;
  const last = memory.lastStrikeHours.get(situation.countryId);
  if (last !== undefined && now - last < STRIKE_COOLDOWN_HOURS) return;
  const sites = situation.provinces.filter(
    (province) => (session.state.provinceBuildings[province.id]?.missileSite ?? 0) > 0,
  );
  if (sites.length === 0) return;

  const width = session.world.width;
  let best = situation.enemyProvinces[0] ?? null;
  let bestValue = 0;
  for (const province of situation.enemyProvinces) {
    const inRange = sites.some((site) => wrappedDistance(
      site.center[0], site.center[1], province.center[0], province.center[1], width,
    ) <= MISSILE_RANGE);
    if (!inRange) continue;
    const value = strengthNear(
      situation.enemyArmies, province.center[0], province.center[1], CONTACT_RADIUS, width,
    ) + (situation.enemyCapitals.has(province.id) ? 1500 : 0);
    if (value > bestValue) {
      bestValue = value;
      best = province;
    }
  }
  if (!best || bestValue <= 0) return;
  const done = applyCommand(session, {
    type: 'strike', countryId: situation.countryId, provinceId: best.id,
    x: best.center[0], z: best.center[1],
  }).ok;
  if (done) memory.lastStrikeHours.set(situation.countryId, now);
}

/**
 * 9. Answer peace offers honestly — accept while losing, refuse while winning —
 * and sue for peace when a losing country is fighting too many wars at once.
 * `proposeDiplomacy` only accepts a player-controlled recipient, so an offer
 * can only ever reach a human belligerent.
 */
function negotiate(session: SimContext, memory: AiMemory, situation: Assessment): void {
  const state = session.state;
  for (const proposal of Object.values(state.diplomacyProposals ?? {})) {
    if (proposal.status !== 'pending' || proposal.kind !== 'peace') continue;
    if (proposal.toCountryId !== situation.countryId) continue;
    applyCommand(session, {
      type: 'respondDiplomacy', countryId: situation.countryId,
      proposalId: proposal.id, accept: situation.losing,
    });
    return;
  }
  if (!situation.losing || situation.enemyIds.size < MULTI_FRONT_WARS) return;
  const now = state.clock.gameTimeHours;
  const last = memory.lastPeaceOfferHours.get(situation.countryId);
  if (last !== undefined && now - last < PEACE_OFFER_COOLDOWN_HOURS) return;

  let target = -1;
  let targetSize = 0;
  for (const enemyId of situation.enemyIds) {
    if (state.countries[enemyId]?.controller !== 'player') continue;
    const size = situation.enemySizes.get(enemyId) ?? 0;
    if (size > targetSize) {
      targetSize = size;
      target = enemyId;
    }
  }
  if (target < 0) return;
  const done = applyCommand(session, {
    type: 'proposeDiplomacy', countryId: situation.countryId,
    targetCountryId: target, proposal: 'peace',
  }).ok;
  if (done) memory.lastPeaceOfferHours.set(situation.countryId, now);
}
