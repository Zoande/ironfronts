export { GameSession } from '../../../src/game/game-session';
export { initGameState } from '../../../src/game/scenario-init';
export { scenarioById } from '../../../src/game/scenario-catalog';
export { buildWorldData } from '../../../src/game/world-data-loader';
export { projectArmyView, visibleResourceNodes } from '../../../src/game/player-view';
export { computeArmyVisibility } from '../../../src/game/visibility';
export { legalRetreatPaths } from '../../../src/game/combat';
export type { CombatEvent } from '../../../src/game/combat';
export { nearestNode } from '../../../src/game/movement/graph';
export { findPath } from '../../../src/game/movement/pathfind';
export { UNIT_TYPES, BASE_UNIT_IDS, baseUnitId, unitType } from '../../../src/game/units/unit-catalog';
export { stackExtractionRate } from '../../../src/game/units/army';
export { currentMovementLeg } from '../../../src/game/units/movement';
export { BUILDINGS } from '../../../src/game/construction';
export { buildOptions } from '../../../src/game/construction';
export { producibleUnits, unitProductionWorkRate, UNIT_PRODUCTION_RATE_BY_LEVEL } from '../../../src/game/production';
export { BUILDING_REQUIRED_PHASE, PHASE_LABELS, PHASE_MAX } from '../../../src/game/phase';
export {
  declareWar, endAlliance, proposeDiplomacy, respondDiplomacy, sendDiplomaticMessage,
} from '../../../src/game/diplomacy';
export type {
  GameState, CountryState, DiplomacyMessage, DiplomacyProposal, Relation, ResourceNodeState,
  ProvinceEconomy, PhysicalResource, ResourceBuildingId, ResourcePotential, UpkeepResource,
  TechnologyBranch, TechnologyLevels, ResearchState,
  WorldWeather,
} from '../../../src/game/game-state';
export { automaticWeatherForDay, updateRealWeather, setWeatherMode } from '../../../src/game/weather';
export {
  generateResourcePotential, createProvinceEconomies, deterministicResourceNoise,
  gaussianHubContribution, resourceHubSpread, wrappedWorldDistance,
} from '../../../src/game/economy/resource-generation';
export { RESOURCE_HUBS } from '../../../src/game/economy/resource-hubs';
export {
  buildEngineerAssignmentIndex, engineerAssignmentKey, physicalResourceOutput, provinceResourceOutputBreakdown,
} from '../../../src/game/economy/resource-production';
export { runEconomySimulation } from '../../../src/game/economy/simulator';
export { unitStatMultiplier, stackOrganizationCap, armyShortageSummary } from '../../../src/game/economy/shortages';
export { RESOURCE_TIER_GATES, maximumResourceTier } from '../../../src/game/economy/resources';
export type { GameCommand, CommandResult } from '../../../src/game/commands';
export type { WorldData } from '../../../src/game/world-data';
export type { LandGraph } from '../../../src/game/movement/graph';
export type { PlayerArmyView } from '../../../src/game/player-view';

export {
  FIXED_STEP_SECONDS, FIXED_STEP_HOURS, MAX_SIMULATION_STEP_SECONDS,
  MAX_SIMULATION_STEP_HOURS, gameEpochMs, INITIAL_GAME_EPOCH_MS,
} from '../../../src/game/time';
export {
  GAME_PACE, NORMAL_GAME_SPEED, MIN_DEBUG_GAME_SPEED, MAX_DEBUG_GAME_SPEED,
} from '../../../src/game/pacing';
export { extractionEligibility } from '../../../src/game/extraction';
export { movementEdgeAllowed } from '../../../src/game/units/movement';
export { parseGameState } from '../../../src/game/state-schema';
export {
  TECHNOLOGY_BRANCHES, TECHNOLOGY_HOURS_BY_LEVEL, TECHNOLOGY_LABELS,
  TECHNOLOGY_MAX_LEVEL, initialTechnologyLevels, startResearch, stepTechnology,
} from '../../../src/game/technology';
