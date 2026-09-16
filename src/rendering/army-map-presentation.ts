/** Six silhouettes shown in the strategic counter atlas. */
export type ArmyVisualKind = 0 | 1 | 2 | 3 | 4 | 5;
/** Five close-range model families; engineers share infantry. Light tanks get
 *  their own skinned model, so they are split from the armored-car hull they
 *  used to share (kind 1) into kind 4. */
/** Kind 5 is the procedural transport ship used while a stack is at sea. */
export type ArmyModelKind = 0 | 1 | 2 | 3 | 4 | 5;

export interface ProjectedTroopGroup {
  readonly typeId: string;
  readonly count: number;
  readonly health: number;
}

export interface ArmyFormationGroup {
  readonly kind: ArmyModelKind;
  readonly count: number;
  readonly health: number;
}

export interface ArmyCompositionRow {
  readonly kind: ArmyVisualKind;
  readonly count: number;
  readonly health: number;
}

export function visualKindForUnit(typeId: string): ArmyVisualKind {
  typeId = typeId.replace(/-l[2-8]$/, '');
  if (typeId === 'engineer') return 1;
  if (typeId === 'armored-car') return 2;
  if (typeId === 'light-tank') return 3;
  if (typeId === 'medium-tank') return 4;
  if (typeId === 'artillery') return 5;
  return 0;
}

function modelKindForUnit(typeId: string): ArmyModelKind {
  typeId = typeId.replace(/-l[2-8]$/, '');
  if (typeId === 'armored-car') return 1;
  if (typeId === 'medium-tank') return 2;
  if (typeId === 'artillery') return 3;
  if (typeId === 'light-tank') return 4;
  return 0;
}

/** Keep all six rule-level categories distinct, ordered by battlefield weight. */
export function buildArmyCompositionRows(groups: readonly ProjectedTroopGroup[]): ArmyCompositionRow[] {
  const buckets = new Map<ArmyVisualKind, { count: number; weightedHealth: number }>();
  for (const group of groups) {
    if (group.count <= 0) continue;
    const kind = visualKindForUnit(group.typeId);
    const bucket = buckets.get(kind) ?? { count: 0, weightedHealth: 0 };
    bucket.count += group.count;
    bucket.weightedHealth += group.health * group.count;
    buckets.set(kind, bucket);
  }
  return [...buckets.entries()]
    .map(([kind, bucket]) => ({ kind, count: bucket.count, health: bucket.weightedHealth / bucket.count }))
    .sort((a, b) => b.count - a.count || a.kind - b.kind);
}

/** Spread the composition categories over at most four close-range models. */
export function buildArmyFormation(groups: readonly ProjectedTroopGroup[]): ArmyFormationGroup[] {
  const buckets = new Map<ArmyModelKind, { count: number; weightedHealth: number }>();
  for (const group of groups) {
    if (group.count <= 0) continue;
    const kind = modelKindForUnit(group.typeId);
    const bucket = buckets.get(kind) ?? { count: 0, weightedHealth: 0 };
    bucket.count += group.count;
    bucket.weightedHealth += group.health * group.count;
    buckets.set(kind, bucket);
  }
  const categories = [...buckets.entries()]
    .map(([kind, bucket]) => ({
      kind, count: bucket.count, health: bucket.weightedHealth / bucket.count, slots: 1, remainder: 0,
    }))
    .sort((a, b) => a.kind - b.kind);
  const totalUnits = categories.reduce((sum, category) => sum + category.count, 0);
  const slotLimit = Math.min(4, totalUnits);
  const remaining = Math.max(0, slotLimit - categories.length);
  if (remaining > 0) {
    let assigned = 0;
    for (const category of categories) {
      const exact = remaining * category.count / totalUnits;
      const whole = Math.floor(exact);
      category.slots += whole;
      category.remainder = exact - whole;
      assigned += whole;
    }
    for (const category of [...categories].sort((a, b) =>
      b.remainder - a.remainder || b.count - a.count || a.kind - b.kind)) {
      if (assigned >= remaining) break;
      category.slots += 1;
      assigned += 1;
    }
  }
  return categories.flatMap((category) => Array.from({ length: category.slots }, () => ({
    kind: category.kind, count: category.count, health: category.health,
  })));
}

export function dominantVisualKind(formation: readonly ArmyCompositionRow[]): ArmyVisualKind {
  return formation.reduce((dominant, candidate) => candidate.count > dominant.count ? candidate : dominant,
    formation[0] ?? { kind: 0 as const, count: 0, health: 0 }).kind;
}
