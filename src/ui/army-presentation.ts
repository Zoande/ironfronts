export interface ArmyGroupStatSource {
  readonly typeId: string;
  readonly count: number;
}

export interface BattleFrontPresentationSource {
  readonly role: 'attack' | 'defense';
  readonly friendlyHp: number;
  readonly friendlyBaselineHp: number;
  readonly enemyHp: number;
  readonly enemyBaselineHp: number;
  readonly reinforcementCount: number;
  readonly outgoingDamagePerGameHour: number;
  readonly incomingDamagePerGameHour: number;
  readonly friendlyCasualties: number;
  readonly enemyCasualties: number;
  readonly estimatedGameHours: number | null;
  readonly estimatedRealSeconds: number | null;
  readonly friendlyModifiers: {
    readonly frontageUsed: number;
    readonly frontageLimit: number;
    readonly coordination: number;
    readonly organization: number;
    readonly stanceOutput: number;
    readonly supply: number;
    readonly protection: number;
    readonly terrain: number;
    readonly devastation: number;
  };
  readonly enemyModifiers?: {
    readonly frontageUsed: number;
    readonly frontageLimit: number;
    readonly coordination: number;
    readonly organization: number;
    readonly stanceOutput: number;
    readonly supply: number;
    readonly protection: number;
    readonly terrain: number;
    readonly devastation: number;
  };
}

export interface BattleSidePresentation {
  readonly hp: number;
  readonly baselineHp: number;
  readonly healthPercent: number;
  readonly organizationPercent: number;
  readonly damagePerGameHour: number;
}

export interface BattleOverviewPresentation {
  readonly role: 'attack' | 'defense' | 'mixed';
  readonly frontCount: number;
  readonly reinforcementCount: number;
  readonly friendly: BattleSidePresentation;
  readonly enemy: BattleSidePresentation;
  readonly outgoingDamagePerGameHour: number;
  readonly incomingDamagePerGameHour: number;
  readonly friendlyCasualties: number;
  readonly enemyCasualties: number;
  readonly estimatedGameHours: number | null;
  readonly estimatedRealSeconds: number | null;
  readonly modifiers: readonly string[];
}

const finiteNonNegative = (value: number): number => Number.isFinite(value) ? Math.max(0, value) : 0;

/** Authoritative HP stays fractional; only the player-facing number is rounded. */
export function roundDisplayedHp(value: number): number {
  return Math.round(finiteNonNegative(value));
}

/** Condense an unbounded directional-front list into one fixed-size battle readout. */
export function summarizeBattleFronts(
  fronts: readonly BattleFrontPresentationSource[] | undefined,
): BattleOverviewPresentation | null {
  if (!fronts?.length) return null;
  const side = (friendly: boolean): BattleSidePresentation => {
    const hp = fronts.reduce((sum, front) => sum + finiteNonNegative(friendly ? front.friendlyHp : front.enemyHp), 0);
    const baselineHp = fronts.reduce(
      (sum, front) => sum + finiteNonNegative(friendly ? front.friendlyBaselineHp : front.enemyBaselineHp), 0,
    );
    return {
      hp,
      baselineHp,
      healthPercent: baselineHp > 0 ? Math.round(Math.min(1, hp / baselineHp) * 100) : 0,
      organizationPercent: Math.round(average((front) => friendly
        ? front.friendlyModifiers.organization : (front.enemyModifiers?.organization ?? 0)) * 100),
      damagePerGameHour: sum((front) => friendly
        ? front.outgoingDamagePerGameHour : front.incomingDamagePerGameHour),
    };
  };
  const firstRole = fronts[0].role;
  const sum = (value: (front: BattleFrontPresentationSource) => number): number => fronts.reduce(
    (total, front) => total + finiteNonNegative(value(front)), 0,
  );
  const average = (value: (front: BattleFrontPresentationSource) => number): number => sum(value) / fronts.length;
  const minimumDuration = (field: 'estimatedGameHours' | 'estimatedRealSeconds'): number | null => {
    const values = fronts.map((front) => front[field]).filter(
      (value): value is number => value !== null && Number.isFinite(value) && value >= 0,
    );
    return values.length ? Math.min(...values) : null;
  };
  const factor = (value: number): string => `×${value.toFixed(2)}`;
  return {
    role: fronts.every((front) => front.role === firstRole) ? firstRole : 'mixed',
    frontCount: fronts.length,
    reinforcementCount: fronts.reduce(
      (sum, front) => sum + Math.floor(finiteNonNegative(front.reinforcementCount)), 0,
    ),
    friendly: side(true),
    enemy: side(false),
    outgoingDamagePerGameHour: sum((front) => front.outgoingDamagePerGameHour),
    incomingDamagePerGameHour: sum((front) => front.incomingDamagePerGameHour),
    friendlyCasualties: sum((front) => front.friendlyCasualties),
    enemyCasualties: sum((front) => front.enemyCasualties),
    estimatedGameHours: minimumDuration('estimatedGameHours'),
    estimatedRealSeconds: minimumDuration('estimatedRealSeconds'),
    modifiers: [
      `Frontage ${sum((front) => front.friendlyModifiers.frontageUsed)} / ${sum((front) => front.friendlyModifiers.frontageLimit)}`,
      `Coordination ${factor(average((front) => front.friendlyModifiers.coordination))}`,
      `Organization ${factor(average((front) => front.friendlyModifiers.organization))}`,
      `Stance output ${factor(average((front) => front.friendlyModifiers.stanceOutput))}`,
      `Supply ${factor(average((front) => front.friendlyModifiers.supply))}`,
      `Protection ${factor(average((front) => front.friendlyModifiers.protection))}`,
      `Terrain ${factor(average((front) => front.friendlyModifiers.terrain))}`,
      `Devastation ${factor(average((front) => front.friendlyModifiers.devastation))}`,
    ],
  };
}

export function aggregateTroopStat(
  groups: readonly ArmyGroupStatSource[] | undefined,
  field: 'attack' | 'defense',
  unit: (typeId: string) => Record<string, unknown>,
): { soft: number; light: number; heavy: number } | undefined {
  if (!groups) return undefined;
  return groups.reduce((total, group) => {
    const profile = unit(group.typeId)[field] as Partial<Record<'soft' | 'light' | 'heavy', number>> | undefined;
    total.soft += Number(profile?.soft ?? 0) * group.count;
    total.light += Number(profile?.light ?? 0) * group.count;
    total.heavy += Number(profile?.heavy ?? 0) * group.count;
    return total;
  }, { soft: 0, light: 0, heavy: 0 });
}

export function armyActivityLabel(status: string, awaitingMoveTarget: boolean, own: boolean): string {
  if (awaitingMoveTarget && own) return 'Awaiting destination';
  if (status === 'moving') return 'Moving to destination';
  if (status === 'engaged') return 'Engaged in combat';
  if (status === 'retreating') return 'Withdrawing';
  if (status === 'extracting') return 'Extracting resources';
  if (status === 'embarking') return 'Embarking…';
  if (status === 'atSea') return 'At sea';
  if (status === 'disembarking') return 'Disembarking…';
  if (status === 'idle') return 'Holding position';
  return status.replace(/(^|[-_ ])\w/g, (letter) => letter.toUpperCase());
}
