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
}

export interface BattleSidePresentation {
  readonly hp: number;
  readonly baselineHp: number;
  readonly healthPercent: number;
}

export interface BattleOverviewPresentation {
  readonly role: 'attack' | 'defense' | 'mixed';
  readonly frontCount: number;
  readonly reinforcementCount: number;
  readonly friendly: BattleSidePresentation;
  readonly enemy: BattleSidePresentation;
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
    };
  };
  const firstRole = fronts[0].role;
  return {
    role: fronts.every((front) => front.role === firstRole) ? firstRole : 'mixed',
    frontCount: fronts.length,
    reinforcementCount: fronts.reduce(
      (sum, front) => sum + Math.floor(finiteNonNegative(front.reinforcementCount)), 0,
    ),
    friendly: side(true),
    enemy: side(false),
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
  if (status === 'idle') return 'Holding position';
  return status.replace(/(^|[-_ ])\w/g, (letter) => letter.toUpperCase());
}
