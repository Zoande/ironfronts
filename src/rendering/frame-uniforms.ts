export const FRAME_UNIFORM_OFFSETS = {
  viewProjection: 0,
  inverseViewProjection: 16,
  camera: 32,
  sunTime: 36,
  viewport: 40,
  map: 44,
  interaction: 48,
  terrainInfo: 52,
  lighting: 56,
  sky: 60,
  weather: 64,
} as const;

export const FRAME_UNIFORM_FLOATS = 68;
export const FRAME_UNIFORM_BYTES = FRAME_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT;

type Vec4 = readonly [number, number, number, number];

export interface FrameUniformValues {
  viewProjection: ArrayLike<number>;
  inverseViewProjection: ArrayLike<number>;
  camera: Vec4;
  sunTime: Vec4;
  viewport: Vec4;
  map: Vec4;
  interaction: Vec4;
  terrainInfo: Vec4;
  lighting: Vec4;
  sky: Vec4;
  weather: Vec4;
}

export function packFrameUniforms(
  source: FrameUniformValues,
  target: Float32Array<ArrayBuffer> = new Float32Array(FRAME_UNIFORM_FLOATS),
): Float32Array<ArrayBuffer> {
  if (target.length !== FRAME_UNIFORM_FLOATS) {
    throw new Error(`Frame uniform target must contain ${FRAME_UNIFORM_FLOATS} floats`);
  }
  if (source.viewProjection.length !== 16 || source.inverseViewProjection.length !== 16) {
    throw new Error('Frame uniform matrices must contain 16 floats');
  }
  for (const [name, offset] of Object.entries(FRAME_UNIFORM_OFFSETS)) {
    target.set(source[name as keyof FrameUniformValues], offset);
  }
  return target;
}
