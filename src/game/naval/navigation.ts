/** Native fleets never enter a land road or become a transport manifestation. */
import type { SimContext } from '../sim-context';
import type { WorldData } from '../world-data';
import type { ArmyStack, MoveOrder } from '../units/army';
import { stackBaseSpeed } from '../units/army';
import { unitType } from '../units/unit-catalog';
import { wrappedDistance, wrapX } from '../geometry';
import { MinHeap } from '../movement/min-heap';
import { supplyEffectiveness } from '../combat/supply';
import { GAME_PACE } from '../pacing';
import { computeArmyVisibility } from '../visibility';
import type { CommandResult } from '../commands/types';
type Point = { x: number; z: number };
const launchCache = new WeakMap<WorldData, Map<number, Point | null>>();
export function isWater(world: WorldData, point: Point): boolean {
  return point.x >= 0 && point.x < world.width && point.z >= 0 && point.z < world.height && world.provinceAt(point.x, point.z) < 0;
}
function deltaX(a: number, b: number, width: number): number { return ((b - a + width * 1.5) % width) - width / 2; }
export function clearWaterSegment(world: WorldData, a: Point, b: Point): boolean {
  const dx = deltaX(a.x, b.x, world.width), dz = b.z - a.z;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 4));
  for (let i = 0; i <= steps; i++) if (!isWater(world, { x: wrapX(a.x + dx * i / steps, world.width), z: a.z + dz * i / steps })) return false;
  return true;
}
/** A nearby navigable launch belonging to this particular coastal province. Cached per immutable map. */
export function navalLaunchPoint(world: WorldData, provinceId: number): Point | null {
  let cache = launchCache.get(world); if (!cache) { cache = new Map(); launchCache.set(world, cache); }
  if (cache.has(provinceId)) return cache.get(provinceId)!;
  const province = world.provinces.find((p) => p.id === provinceId);
  let found: Point | null = null;
  if (province?.coastal) {
    const [x, z] = province.center;
    search: for (let radius = 8; radius <= 1200; radius += 16) {
      const samples = Math.max(16, Math.ceil(2 * Math.PI * radius / 20));
      for (let angle = 0; angle < samples; angle++) {
        const a = angle * 2 * Math.PI / samples;
        const point = { x: wrapX(x + Math.cos(a) * radius, world.width), z: z + Math.sin(a) * radius };
        if (!isWater(world, point)) continue;
        for (let side = 0; side < 8; side++) {
          const direction = side * Math.PI / 4;
          if (world.provinceAt(wrapX(point.x + Math.cos(direction) * 18, world.width), point.z + Math.sin(direction) * 18) === provinceId) {
            found = point; break search;
          }
        }
      }
    }
  }
  cache.set(provinceId, found); return found;
}
/** Water-only A*. Direct routes stay exact; the coarse grid routes around continents/islands. */
export function waterRoute(world: WorldData, start: Point, goal: Point): Point[] | null {
  if (!isWater(world, start) || !isWater(world, goal)) return null;
  if (clearWaterSegment(world, start, goal)) return [goal];
  const nx = Math.ceil(world.width / 24), nz = Math.ceil(world.height / 24);
  const sx = world.width / nx, sz = world.height / nz, size = nx * nz;
  const point = (id: number): Point => ({ x: (id % nx + .5) * sx, z: (Math.floor(id / nx) + .5) * sz });
  const near = (p: Point): number[] => {
    const result: number[] = [];
    const cx = Math.floor(p.x / sx), cz = Math.floor(p.z / sz);
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const row = cz + dz; if (row < 0 || row >= nz) continue;
      const id = row * nx + ((cx + dx + nx) % nx);
      if (clearWaterSegment(world, p, point(id))) result.push(id);
    }
    return result;
  };
  const starts = near(start), ends = new Set(near(goal));
  if (!starts.length || !ends.size) return null;
  const cost = new Float64Array(size).fill(Infinity), previous = new Int32Array(size).fill(-1), closed = new Uint8Array(size);
  const heap = new MinHeap();
  for (const id of starts) { cost[id] = wrappedDistance(start.x, start.z, point(id).x, point(id).z, world.width); heap.push(cost[id], id); }
  let expanded = 0;
  while (heap.size && expanded < 200_000) {
    const [, id] = heap.pop(); if (closed[id]) continue;
    closed[id] = 1; expanded++;
    const p = point(id);
    if (ends.has(id)) {
      const route: Point[] = [goal]; let current = id;
      while (current >= 0) { route.push(point(current)); current = previous[current]; }
      route.reverse();
      // Remove grid zigzags only when the replacement segment is also entirely water.
      const smooth: Point[] = []; let origin = start;
      for (let i = 0; i < route.length;) {
        let next = route.length - 1;
        while (next > i && !clearWaterSegment(world, origin, route[next])) next--;
        smooth.push(route[next]); origin = route[next]; i = next + 1;
      }
      return smooth;
    }
    const row = Math.floor(id / nx), col = id % nx;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dz) || row + dz < 0 || row + dz >= nz) continue;
      const next = (row + dz) * nx + (col + dx + nx) % nx;
      if (closed[next]) continue;
      const q = point(next), candidate = cost[id] + Math.hypot(dx * sx, dz * sz);
      if (candidate >= cost[next] || !clearWaterSegment(world, p, q)) continue;
      cost[next] = candidate; previous[next] = id;
      heap.push(candidate + wrappedDistance(q.x, q.z, goal.x, goal.z, world.width), next);
    }
  }
  return null;
}
export function issueFleetMove(ctx: SimContext, army: ArmyStack, x: number, z: number, intent: 'move' | 'attack', target?: MoveOrder['target']): CommandResult {
  if (army.upgrade) return { ok: false, reason: 'Fleet is upgrading.' };
  const route = waterRoute(ctx.world, army, { x, z });
  if (!route) return { ok: false, reason: 'No navigable water route. Fleets cannot cross land.' };
  army.navalRoute = route; army.order = { path: [], destX: x, destZ: z, intent, target, edgeProgress: 0 };
  army.status = 'atSea'; army.edge = null;
  army.navalTargetArmyId = intent === 'attack' && target?.kind === 'army' ? target.armyId : null;
  if (army.artillery) { army.artillery.targetArmyId = null; army.artillery.manualTarget = false; }
  return { ok: true };
}
export function fleetAttackRange(army: ArmyStack): number {
  return Math.max(24, ...army.units.map((group) => unitType(group.typeId).engagementRange));
}
export function stepFleetMovement(ctx: SimContext, army: ArmyStack, dtHours: number): void {
  const target = army.navalTargetArmyId ? ctx.state.armies[army.navalTargetArmyId] : undefined;
  if (army.navalTargetArmyId && !target) { army.navalTargetArmyId = null; army.order = null; army.navalRoute = []; }
  if (target && !army.order && !army.upgrade && isWater(ctx.world, target)
    && wrappedDistance(army.x, army.z, target.x, target.z, ctx.world.width) > fleetAttackRange(army)
    && computeArmyVisibility(ctx.state, ctx.world, army.ownerCountryId).get(target.id) !== 'hidden') {
    issueFleetMove(ctx, army, target.x, target.z, 'attack', {kind:'army',armyId:target.id,lastKnownX:target.x,lastKnownZ:target.z});
  }
  if (target && army.order) {
    const visible = computeArmyVisibility(ctx.state, ctx.world, army.ownerCountryId).get(target.id) !== 'hidden';
    if (visible && wrappedDistance(army.x, army.z, target.x, target.z, ctx.world.width) <= fleetAttackRange(army)) {
      army.order = null; army.navalRoute = [];
      if (army.artillery) { army.artillery.targetArmyId = target.id; army.artillery.manualTarget = true; }
      return;
    }
    // Chase visible movement, never a hidden target's live coordinates.
    const last = army.navalRoute?.at(-1);
    if (visible && isWater(ctx.world, target) && last && wrappedDistance(last.x, last.z, target.x, target.z, ctx.world.width) > 24) {
      const route = waterRoute(ctx.world, army, target);
      if (route) { army.navalRoute = route; Object.assign(army.order, {destX: target.x, destZ: target.z}); }
    }
  }
  let budget = stackBaseSpeed(army) * GAME_PACE.movement.scale * supplyEffectiveness(army) * Math.max(0, dtHours);
  while (army.order && army.navalRoute?.length && budget > 0) {
    const next = army.navalRoute[0], distance = wrappedDistance(army.x, army.z, next.x, next.z, ctx.world.width);
    const fraction = distance > 0 ? Math.min(1, budget / distance) : 1;
    army.x = wrapX(army.x + deltaX(army.x, next.x, ctx.world.width) * fraction, ctx.world.width);
    army.z += (next.z - army.z) * fraction;
    budget -= distance;
    if (fraction >= 1) army.navalRoute.shift(); else break;
  }
  if (!army.navalRoute?.length) army.order = null;
}
