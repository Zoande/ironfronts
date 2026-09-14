/**
 * Authoritative 1x pacing table.
 *
 * Every duration is expressed in simulation hours and every rate is per
 * simulation hour. One simulation second equals one real second at 1x. The
 * server's single debug multiplier changes elapsed simulation time; systems
 * must never add their own wall-clock or debug multiplier.
 */
export const GAME_PACE = {
  clock: {
    realSecondsPerSimulationSecond: 1,
    simulationHoursPerRealSecond: 1 / 3_600,
    livePumpMilliseconds: 100,
    /** Largest deterministic substep used for catch-up and extreme debug speed. */
    maximumIntegrationStepSeconds: 15 * 60,
    incomeRefreshHours: 1 / 60,
    supplyRefreshHours: 0.25,
    aiPlanningHours: 0.25,
  },
  movement: {
    /** World units per hour before road, terrain, supply and shortage effects. */
    unitWorldUnitsPerHour: {
      infantry: 70,
      engineer: 65,
      'armored-car': 150,
      'light-tank': 125,
      'medium-tank': 95,
      artillery: 55,
    },
    scale: 1,
    roadMultiplier: 1.35,
    retreatMultiplier: 3,
    /** Thirty real minutes at 1x: troops must assemble transport before sailing. */
    navalDwellHours: 0.5,
  },
  combat: {
    /** A 1v1 infantry fight lasts roughly 1.5 hours at full readiness. */
    damageScale: 12.5,
    organizationDrainPerHour: 1.5,
    organizationRegenPerHour: 4,
    hoursToFullEntrenchment: 48,
  },
  strategic: {
    phase2FallbackHours: 72,
    phase3FallbackHours: 168,
    warheadHours: 168,
    devastationHours: 6 * 24,
  },
} as const;

export const NORMAL_GAME_SPEED = 1;
export const MIN_DEBUG_GAME_SPEED = 1;
export const MAX_DEBUG_GAME_SPEED = 10_000;

export type PacedUnitId = keyof typeof GAME_PACE.movement.unitWorldUnitsPerHour;
