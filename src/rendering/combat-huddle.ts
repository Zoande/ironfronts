/**
 * Purely visual "combat huddle" for engaged army-stack pairs.
 *
 * Two hostile stacks trigger a fight once they come within COMBAT_SNAP world
 * units (see src/game/combat/constants.ts) — but that authoritative trigger
 * range is still wide enough (and a front can gain reinforcements from an
 * adjacent road node afterward) that a fight can render far apart on the map,
 * reading as distant icons rather than a clash. This module never touches
 * simulation coordinates; it only computes a render-layer nudge the caller
 * adds to the *displayed* position, so it can never desync the client from
 * the authoritative sim or multiplayer state.
 *
 * Grouping is keyed off the authoritative battle-front id the sim already
 * assigns (PlayerArmyView.battleFronts[].id — see src/game/player-view.ts),
 * not a distance/grid heuristic, so it can never miss a pair the sim itself
 * considers engaged. The player projection never ships a front's own x/z (or
 * its province id), so each cluster's anchor is the centroid of its current
 * members' positions instead — every army sharing a front converges toward
 * that same anchor, and spawnOngoingBattleFx (src/main.ts) spawns its FX at
 * that exact point too, so the huddle and the FX never drift apart.
 */

export interface Point {
  readonly x: number;
  readonly z: number;
}

export interface HuddleOffset {
  readonly x: number;
  readonly z: number;
}

const ZERO: HuddleOffset = { x: 0, z: 0 };

/** Rendered gap (world units) an engaged stack huddles down to around its
 *  battle anchor — small enough that two badges read as one clash. */
export const HUDDLE_TARGET_RADIUS = 30;
/** Safety cap on the pull distance so a stray/mis-clustered stack can never
 *  visually teleport across the map. */
export const HUDDLE_MAX_PULL = 260;

/**
 * Render-only offset pulling `self` toward the shared `anchor` for its
 * battle cluster, closing the gap to at most `targetRadius` world units
 * (capped by `maxPull`). Returns {0,0} once already inside the radius.
 */
export function combatHuddleOffset(
  self: Point,
  anchor: Point,
  targetRadius: number = HUDDLE_TARGET_RADIUS,
  maxPull: number = HUDDLE_MAX_PULL,
): HuddleOffset {
  const dx = anchor.x - self.x;
  const dz = anchor.z - self.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= targetRadius) return ZERO;
  const pull = Math.min(maxPull, dist - targetRadius);
  return { x: (dx / dist) * pull, z: (dz / dist) * pull };
}

export interface EngagedStackLike {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly ownerCountryId: number;
  /** ids of every live battle front this army currently reports. An army
   *  fighting on more than one front joins every one of those clusters (so a
   *  front never silently loses a member just because that army also has a
   *  second, unrelated fight going). Pass [] for a non-engaged stack. */
  readonly frontIds: readonly string[];
}

export interface BattleCluster {
  readonly x: number;
  readonly z: number;
  readonly ownerCountryIds: ReadonlySet<number>;
  readonly memberIds: readonly string[];
}

/**
 * Group engaged stacks by every authoritative battle-front id they report,
 * with each cluster's position the centroid of its current members. Stacks
 * with no front id contribute nothing.
 */
export function groupEngagedByFront(stacks: Iterable<EngagedStackLike>): Map<string, BattleCluster> {
  const sums = new Map<string, { sumX: number; sumZ: number; owners: Set<number>; members: string[] }>();
  for (const stack of stacks) {
    for (const frontId of stack.frontIds) {
      const group = sums.get(frontId) ?? { sumX: 0, sumZ: 0, owners: new Set<number>(), members: [] };
      group.sumX += stack.x;
      group.sumZ += stack.z;
      group.owners.add(stack.ownerCountryId);
      group.members.push(stack.id);
      sums.set(frontId, group);
    }
  }
  const clusters = new Map<string, BattleCluster>();
  for (const [frontId, group] of sums) {
    clusters.set(frontId, {
      x: group.sumX / group.members.length,
      z: group.sumZ / group.members.length,
      ownerCountryIds: group.owners,
      memberIds: group.members,
    });
  }
  return clusters;
}

/** One shared anchor per army id, taken from its cluster's centroid. An army
 *  in more than one cluster (fighting two fronts) gets whichever cluster is
 *  visited last — still a real fight it's in, never a no-op. */
export function buildBattleAnchors(clusters: ReadonlyMap<string, BattleCluster>): Map<string, Point> {
  const anchors = new Map<string, Point>();
  for (const cluster of clusters.values()) {
    const anchor: Point = { x: cluster.x, z: cluster.z };
    for (const id of cluster.memberIds) anchors.set(id, anchor);
  }
  return anchors;
}
