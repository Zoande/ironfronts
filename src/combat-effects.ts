/**
 * Event-driven, fixed-capacity pool for world-space combat visuals.
 *
 * Pure data + arithmetic — no GPU, no DOM — so the lifecycle is unit-testable.
 * The renderer owns one instanced quad layer and asks the pool for a packed
 * buffer each frame via `collect()`; the pool never allocates per frame once
 * constructed (the packed buffer is reused in place).
 *
 * Two populations share the layer:
 *  - transient bursts (muzzle flash, tracer, impact, dust, smoke, explosion,
 *    target flash) held in a ring buffer and aged out by lifetime;
 *  - one persistent marker per active battle (crossed weapons + pulse),
 *    refreshed while the battle lives and dropped when it ends.
 *
 * Combat audio pairs with the same events but is the caller's job (near-camera
 * only) — see main.ts.
 */

export const EFFECT_KIND = {
  muzzleFlash: 0,
  tracer: 1,
  projectile: 2,
  impact: 3,
  dust: 4,
  smoke: 5,
  explosion: 6,
  targetFlash: 7,
  battleMarker: 8,
} as const;
export type EffectKind = (typeof EFFECT_KIND)[keyof typeof EFFECT_KIND];

/** Floats per packed instance: x, z, kind, age01, seed, scale, intensity, dir. */
export const EFFECT_STRIDE = 8;

const DEFAULT_LIFETIME_MS: Record<number, number> = {
  [EFFECT_KIND.muzzleFlash]: 140,
  [EFFECT_KIND.tracer]: 260,
  [EFFECT_KIND.projectile]: 900,
  [EFFECT_KIND.impact]: 380,
  [EFFECT_KIND.dust]: 1_400,
  [EFFECT_KIND.smoke]: 2_600,
  [EFFECT_KIND.explosion]: 720,
  [EFFECT_KIND.targetFlash]: 520,
  [EFFECT_KIND.battleMarker]: Number.POSITIVE_INFINITY,
};

interface Transient {
  kind: number;
  x: number;
  z: number;
  birth: number;
  lifetime: number;
  seed: number;
  scale: number;
  intensity: number;
  dir: number;
}

interface BattleMarker {
  x: number;
  z: number;
  intensity: number;
  seed: number;
  /** Compass direction of the attack, radians (0 = +x). NaN = unknown. */
  dir: number;
}

export interface SpawnOptions {
  scale?: number;
  intensity?: number;
  seed?: number;
  lifetimeMs?: number;
  /** Attack / travel direction in radians; used by tracers and projectiles. */
  dir?: number;
  now?: number;
}

export interface CollectResult {
  readonly floats: Float32Array;
  readonly count: number;
}

export class CombatEffectPool {
  readonly capacity: number;
  private readonly ring: Transient[] = [];
  private ringHead = 0;
  private readonly battles = new Map<string, BattleMarker>();
  private readonly packed: Float32Array;
  private rngState = 0x9e3779b9;

  constructor(capacity = 256) {
    this.capacity = Math.max(16, capacity);
    this.packed = new Float32Array(this.capacity * EFFECT_STRIDE);
  }

  private random(): number {
    // xorshift32 — deterministic, no allocation.
    let x = this.rngState;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.rngState = x >>> 0;
    return this.rngState / 0xffffffff;
  }

  /** Queue one transient effect. Overwrites the oldest slot when full. */
  spawn(kind: EffectKind, x: number, z: number, options: SpawnOptions = {}): void {
    if (kind === EFFECT_KIND.battleMarker) return; // markers go through setBattle
    const now = options.now ?? Date.now();
    const record: Transient = {
      kind,
      x,
      z,
      birth: now,
      lifetime: options.lifetimeMs ?? DEFAULT_LIFETIME_MS[kind] ?? 500,
      seed: options.seed ?? this.random(),
      scale: options.scale ?? 1,
      intensity: options.intensity ?? 1,
      dir: options.dir ?? Number.NaN,
    };
    if (this.ring.length < this.capacity) {
      this.ring.push(record);
    } else {
      this.ring[this.ringHead] = record;
      this.ringHead = (this.ringHead + 1) % this.capacity;
    }
  }

  /**
   * Spawn a small burst appropriate to a single authoritative volley from a
   * unit category. Strategic scale — a few effects per volley, never one per
   * simulated round.
   */
  spawnVolley(
    category: 'infantry' | 'armor' | 'artillery' | 'generic',
    x: number, z: number, dir: number, options: SpawnOptions = {},
  ): void {
    const now = options.now ?? Date.now();
    const jitter = (spread: number): number => (this.random() - 0.5) * spread;
    const at = (): [number, number] => [x + jitter(28), z + jitter(28)];
    if (category === 'infantry') {
      for (let i = 0; i < 3; i += 1) {
        const [px, pz] = at();
        this.spawn(EFFECT_KIND.muzzleFlash, px, pz, { now, dir, scale: 0.6 });
        this.spawn(EFFECT_KIND.tracer, px, pz, { now, dir, scale: 0.7 });
      }
      this.spawn(EFFECT_KIND.dust, x + jitter(20), z + jitter(20), { now, scale: 0.7 });
    } else if (category === 'armor') {
      this.spawn(EFFECT_KIND.muzzleFlash, x, z, { now, dir, scale: 1.1 });
      this.spawn(EFFECT_KIND.projectile, x, z, { now, dir, scale: 1 });
      this.spawn(EFFECT_KIND.impact, x + Math.cos(dir) * 42, z + Math.sin(dir) * 42, { now, scale: 1 });
      this.spawn(EFFECT_KIND.smoke, x, z, { now, scale: 0.8, lifetimeMs: 1_800 });
    } else if (category === 'artillery') {
      this.spawn(EFFECT_KIND.muzzleFlash, x, z, { now, dir, scale: 1.3 });
      this.spawn(EFFECT_KIND.projectile, x, z, { now, dir, scale: 1.4, lifetimeMs: 1_100 });
      // The target explosion is delayed — the caller schedules impact() at the
      // strike point; here we only mark the outgoing cue + local dust.
      this.spawn(EFFECT_KIND.dust, x + jitter(24), z + jitter(24), { now, scale: 1 });
    } else {
      this.spawn(EFFECT_KIND.muzzleFlash, x, z, { now, dir, scale: 0.9 });
      this.spawn(EFFECT_KIND.impact, x, z, { now, scale: 0.9 });
    }
  }

  /** Insert or refresh the persistent marker for a live battle. */
  setBattle(id: string, x: number, z: number, intensity = 1, dir = Number.NaN): void {
    const existing = this.battles.get(id);
    if (existing) {
      existing.x = x; existing.z = z; existing.intensity = intensity; existing.dir = dir;
    } else {
      this.battles.set(id, { x, z, intensity, seed: this.random(), dir });
    }
  }

  /** Drop a battle marker (battle ended). */
  clearBattle(id: string): void {
    this.battles.delete(id);
  }

  /** Reconcile the whole set of live battles in one call. */
  syncBattles(live: ReadonlyArray<{ id: string; x: number; z: number; intensity?: number; dir?: number }>): void {
    const seen = new Set<string>();
    for (const b of live) {
      seen.add(b.id);
      this.setBattle(b.id, b.x, b.z, b.intensity ?? 1, b.dir ?? Number.NaN);
    }
    for (const id of [...this.battles.keys()]) if (!seen.has(id)) this.battles.delete(id);
  }

  get battleCount(): number { return this.battles.size; }

  /** Count of transients not yet expired at `now`. */
  liveTransients(now: number): number {
    let n = 0;
    for (const r of this.ring) if (now - r.birth < r.lifetime) n += 1;
    return n;
  }

  /**
   * Pack the visible effect set for one frame.
   *
   * `camera` + `maxDistance` distance-cull transients (markers are kept as long
   * as there is budget — they are the far-zoom representation of a battle).
   * `budget` caps the instance count; battle markers are written first.
   */
  collect(
    now: number,
    camera: { x: number; z: number },
    maxDistance: number,
    budget = this.capacity,
  ): CollectResult {
    const cap = Math.min(budget, this.capacity);
    const out = this.packed;
    let count = 0;
    const write = (
      kind: number, x: number, z: number, age01: number,
      seed: number, scale: number, intensity: number, dir: number,
    ): void => {
      const o = count * EFFECT_STRIDE;
      out[o] = x; out[o + 1] = z; out[o + 2] = kind; out[o + 3] = age01;
      out[o + 4] = seed; out[o + 5] = scale; out[o + 6] = intensity;
      out[o + 7] = Number.isFinite(dir) ? dir : -999;
      count += 1;
    };

    for (const b of this.battles.values()) {
      if (count >= cap) break;
      // A gentle pulse so the marker breathes; the shader reads age01 as phase.
      const phase = ((now * 0.001) % 2) / 2;
      write(EFFECT_KIND.battleMarker, b.x, b.z, phase, b.seed, 1, b.intensity, b.dir);
    }

    const maxSq = maxDistance * maxDistance;
    for (const r of this.ring) {
      if (count >= cap) break;
      const age = now - r.birth;
      if (age < 0 || age >= r.lifetime) continue;
      const dx = r.x - camera.x;
      const dz = r.z - camera.z;
      if (dx * dx + dz * dz > maxSq) continue;
      write(r.kind, r.x, r.z, age / r.lifetime, r.seed, r.scale, r.intensity, r.dir);
    }
    return { floats: out, count };
  }

  /** Drop every transient and marker (scene reset / renderer dispose). */
  clear(): void {
    this.ring.length = 0;
    this.ringHead = 0;
    this.battles.clear();
  }
}

/**
 * Fraction of the full effect set worth spawning at a camera distance — the
 * caller uses it to thin or skip spawns so a battle 8000u away costs almost
 * nothing while a battle under the camera gets the full show.
 */
export function effectDensityForDistance(cameraDistance: number): number {
  if (cameraDistance <= 1_400) return 1;
  if (cameraDistance >= 5_000) return 0;
  return 1 - (cameraDistance - 1_400) / (5_000 - 1_400);
}

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/**
 * 8-point compass label for a world-space delta — mirrors the game server's
 * `bearingLabel` (north is -z, east is +x) so the HUD and the server agree.
 */
export function compassLabel(dx: number, dz: number): string {
  if ((dx === 0 && dz === 0) || !Number.isFinite(dx) || !Number.isFinite(dz)) return '';
  const deg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  return COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
