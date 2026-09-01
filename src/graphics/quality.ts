/**
 * Graphics quality presets.
 *
 * A single, self-contained settings module: the only persistent graphics
 * preference the game has today. It is intentionally free of renderer / DOM
 * imports so the lobby can read and store the choice without pulling in the
 * WorldRenderer. The renderer consumes the resolved preset after launch.
 */

export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export const QUALITY_LEVELS: readonly QualityLevel[] = ['low', 'medium', 'high', 'ultra'];

/** Default on first run. Deliberately not ULTRA. */
export const DEFAULT_QUALITY: QualityLevel = 'high';

const STORAGE_KEY = 'ironfronts:graphics-quality';

export interface QualityPreset {
  /** Menu label. */
  readonly label: string;
  /** Sub-line shown under the selector. */
  readonly blurb: string;
  /**
   * Backing-store scale relative to CSS pixels. Applied absolutely (see
   * resolveRenderPixelRatio) so a 4K / retina panel never forces a 2x/3x
   * buffer just because the device supports it.
   */
  readonly renderScale: number;
  /** Multiplies every prop (tree / building / furniture) draw + LOD distance. */
  readonly propDistanceScale: number;
  /** Hard cap on visible tree instances submitted per frame. */
  readonly treeInstanceBudget: number;
  /** Hard cap on visible building instances submitted per frame. */
  readonly buildingInstanceBudget: number;
  /** Draw decorative road furniture (lamps, barriers, signs) at all. */
  readonly furniture: boolean;
  /** Multiplies the terrain chunk LOD switch distances (<1 = coarser sooner). */
  readonly terrainLodScale: number;
  /** Multiplies the viewport-derived rain particle count. */
  readonly rainScale: number;
  /**
   * 0..1 detail signal handed to shaders via uniforms.weather.z. Lets shader
   * work that is expensive but purely decorative (relief noise, extra water
   * passes, AO) scale itself down without another uniform.
   */
  readonly detailFactor: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualityPreset> = {
  low: {
    label: 'Low',
    blurb: 'Best performance — 0.75× render scale, no road furniture, ~9k trees, props fade in close.',
    renderScale: 0.75,
    propDistanceScale: 0.45,
    treeInstanceBudget: 9_000,
    buildingInstanceBudget: 6_000,
    furniture: false,
    // Keep enough terrain-mesh resolution that ridges and coastlines still read
    // as relief — LOW should be cheaper, not flatter. The heavy savings come
    // from render scale, prop budgets and the shader detail factor below.
    terrainLodScale: 0.85,
    rainScale: 0.35,
    detailFactor: 0.12,
  },
  medium: {
    label: 'Medium',
    blurb: 'Balanced — 1× render scale, ~22k trees / 14k buildings, no road furniture, reduced shader detail.',
    renderScale: 1,
    propDistanceScale: 0.7,
    treeInstanceBudget: 22_000,
    buildingInstanceBudget: 14_000,
    furniture: false,
    terrainLodScale: 0.82,
    rainScale: 0.6,
    detailFactor: 0.4,
  },
  high: {
    label: 'High',
    blurb: 'High-quality strategic map — 1.25× render scale, road furniture on, ~60k trees / 40k buildings, full relief shading.',
    renderScale: 1.25,
    propDistanceScale: 1,
    treeInstanceBudget: 60_000,
    buildingInstanceBudget: 40_000,
    furniture: true,
    terrainLodScale: 1,
    rainScale: 1,
    detailFactor: 0.75,
  },
  ultra: {
    label: 'Ultra',
    blurb: 'Maximum world detail — 1.5× render scale, finest terrain LOD, near-unlimited trees/buildings, every shader pass on.',
    renderScale: 1.5,
    propDistanceScale: 1.25,
    treeInstanceBudget: 400_000,
    buildingInstanceBudget: 400_000,
    furniture: true,
    terrainLodScale: 1.18,
    rainScale: 1,
    detailFactor: 1,
  },
};

/**
 * Backing-store pixel ratio for a preset. Absolute (× CSS pixels), independent
 * of devicePixelRatio, clamped to [0.5, 1.5] so a HiDPI display never blows the
 * buffer up to 2x/3x and a broken preset can never drop below 0.5x.
 */
export function resolveRenderPixelRatio(level: QualityLevel): number {
  const target = QUALITY_PRESETS[level]?.renderScale ?? QUALITY_PRESETS[DEFAULT_QUALITY].renderScale;
  return Math.max(0.5, Math.min(1.5, target));
}

export function isQualityLevel(value: unknown): value is QualityLevel {
  return typeof value === 'string' && (QUALITY_LEVELS as readonly string[]).includes(value);
}

function safeStorage(explicit?: Storage): Storage | undefined {
  if (explicit) return explicit;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadQuality(storage?: Storage): QualityLevel {
  try {
    const raw = safeStorage(storage)?.getItem(STORAGE_KEY);
    if (isQualityLevel(raw)) return raw;
  } catch {
    // Private mode / disabled storage: fall through to the default.
  }
  return DEFAULT_QUALITY;
}

export function saveQuality(level: QualityLevel, storage?: Storage): void {
  try {
    safeStorage(storage)?.setItem(STORAGE_KEY, level);
  } catch {
    // Nothing we can do; the in-memory choice still applies this session.
  }
}
