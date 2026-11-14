import type { ProjectedArmy } from '@ironfronts/protocol';

type Point = { x: number; z: number };
export interface QueuedRouteSegment { from: Point; to: Point; attack: boolean }

/** Dashed intent lines, not promises of a future legal route. Never reveal hidden targets. */
export function queuedRouteSegments(
  army: ProjectedArmy, armies: Record<string, ProjectedArmy>, width: number,
): QueuedRouteSegment[] {
  if (!army.own) return [];
  const result: QueuedRouteSegment[] = [];
  let from = army.moveOrder ?? { x: army.x, z: army.z };
  for (const order of army.queuedOrders ?? []) {
    let to: Point;
    if (order.kind === 'attackArmy') {
      const target = armies[order.targetArmyId];
      if (!target || target.contact !== 'visible') break;
      to = { x: target.x, z: target.z };
    } else to = { x: order.x, z: order.z };
    let dx = to.x - from.x;
    if (width > 0) dx -= Math.round(dx / width) * width;
    const dz = to.z - from.z;
    const distance = Math.hypot(dx, dz);
    for (let d = 0; d < distance && result.length < 1024; d += 42) {
      const end = Math.min(distance, d + 24);
      result.push({ from: { x: from.x + dx * d / distance, z: from.z + dz * d / distance },
        to: { x: from.x + dx * end / distance, z: from.z + dz * end / distance }, attack: order.kind !== 'move' });
    }
    // Arrow wings make every queued destination visible even on a short leg.
    if (distance > 0 && result.length < 1022) {
      const tip = { x: from.x + dx, z: to.z };
      for (const side of [-1, 1]) result.push({from:{
        x:tip.x - dx / distance * 8 + side * dz / distance * 4,
        z:tip.z - dz / distance * 8 - side * dx / distance * 4,
      },to:tip,attack:order.kind !== 'move'});
    }
    from = to;
  }
  return result;
}
