import { presentedArmyPosition, type ArmyPickEntry } from '../rendering/army-motion';

/** CPU picking owns the same bounded trajectory uploaded to the marker shader. */
export class ArmyPicker {
  private entries: ReadonlyArray<ArmyPickEntry> = [];
  private sampledAtSeconds = 0;

  update(entries: ReadonlyArray<ArmyPickEntry>, sampledAtSeconds: number): void {
    this.entries = entries.map((entry) => ({ ...entry }));
    this.sampledAtSeconds = sampledAtSeconds;
  }

  pick(x: number, z: number, radius: number, worldWidth: number, nowSeconds: number): string | null {
    let best: string | null = null;
    let bestSq = radius * radius;
    const elapsedMs = Math.max(0, nowSeconds - this.sampledAtSeconds) * 1_000;
    for (const entry of this.entries) {
      const point = presentedArmyPosition(entry, elapsedMs);
      let dx = point.x - x;
      if (dx > worldWidth / 2) dx -= worldWidth;
      else if (dx < -worldWidth / 2) dx += worldWidth;
      const dz = point.z - z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < bestSq) { bestSq = distanceSq; best = entry.id; }
    }
    return best;
  }

  /** Every stack within `radius`, nearest first — lets the caller cycle
   *  through co-located stacks (e.g. the two sides of a battle) instead of
   *  only ever reaching whichever one `pick` ranks first. */
  pickAll(x: number, z: number, radius: number, worldWidth: number, nowSeconds: number): string[] {
    const radiusSq = radius * radius;
    const elapsedMs = Math.max(0, nowSeconds - this.sampledAtSeconds) * 1_000;
    const hits: Array<{ id: string; distanceSq: number }> = [];
    for (const entry of this.entries) {
      const point = presentedArmyPosition(entry, elapsedMs);
      let dx = point.x - x;
      if (dx > worldWidth / 2) dx -= worldWidth;
      else if (dx < -worldWidth / 2) dx += worldWidth;
      const dz = point.z - z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < radiusSq) hits.push({ id: entry.id, distanceSq });
    }
    return hits.sort((a, b) => a.distanceSq - b.distanceSq).map((hit) => hit.id);
  }

  clear(): void { this.entries = []; }
}
