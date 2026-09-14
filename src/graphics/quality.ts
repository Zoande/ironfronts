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
const FRAME_RATE_CAP_STORAGE_KEY = 'ironfronts:frame-rate-cap';

/** 0 = uncapped (native refresh rate). Independent of graphics quality — a
 * capped frame rate does not change render scale, LOD, or any visual detail
 * knob above. Defaults to 60: still fully smooth (the standard "smooth"
 * frame rate), but saves real battery on 90/120/144/240Hz panels that a
 * top-down strategy map has no visual use for. Players can still choose
 * Uncapped or 30 explicitly. */
export type FrameRateCap = 0 | 30 | 60;
export const FRAME_RATE_CAPS: readonly FrameRateCap[] = [0, 60, 30];
export const DEFAULT_FRAME_RATE_CAP: FrameRateCap = 60;

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
    blurb: 'High-quality strategic map — 1× render scale, road furniture on, ~40k trees / 26k buildings, full relief shading.',
    // Was 1.25x: this is the default preset every new install lands on, so it
    // was paying a 56% pixel-count tax (1.25^2) before a single player ever
    // opened the settings menu. 1x is already sharp on a non-HiDPI display and
    // exactly matches CSS pixels; Ultra remains the "spend more GPU" option.
    renderScale: 1,
    propDistanceScale: 0.85,
    treeInstanceBudget: 40_000,
    buildingInstanceBudget: 26_000,
    furniture: true,
    terrainLodScale: 0.92,
    rainScale: 0.85,
    detailFactor: 0.6,
  },
  ultra: {
    label: 'Ultra',
    blurb: 'Maximum world detail — 1.35× render scale, finest terrain LOD, dense trees/buildings, every shader pass on.',
    // Was 1.5x render scale with a 400k/400k prop budget — effectively
    // unbounded, so a large campaign's full building/tree count went straight
    // to the GPU with no ceiling at all. Still the "everything on" tier, just
    // no longer an unbounded one.
    renderScale: 1.35,
    propDistanceScale: 1.15,
    treeInstanceBudget: 120_000,
    buildingInstanceBudget: 90_000,
    furniture: true,
    terrainLodScale: 1.1,
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

export function isFrameRateCap(value: unknown): value is FrameRateCap {
  return typeof value === 'number' && (FRAME_RATE_CAPS as readonly number[]).includes(value);
}

export function loadFrameRateCap(storage?: Storage): FrameRateCap {
  try {
    const raw = safeStorage(storage)?.getItem(FRAME_RATE_CAP_STORAGE_KEY);
    const parsed = raw === null || raw === undefined ? NaN : Number(raw);
    if (isFrameRateCap(parsed)) return parsed;
  } catch {
    // Private mode / disabled storage: fall through to the default.
  }
  return DEFAULT_FRAME_RATE_CAP;
}

export function saveFrameRateCap(cap: FrameRateCap, storage?: Storage): void {
  try {
    safeStorage(storage)?.setItem(FRAME_RATE_CAP_STORAGE_KEY, String(cap));
  } catch {
    // Nothing we can do; the in-memory choice still applies this session.
  }
}
