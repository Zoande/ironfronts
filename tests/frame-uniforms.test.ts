import { describe, expect, it } from 'vitest';
import {
  FRAME_UNIFORM_BYTES, FRAME_UNIFORM_FLOATS, FRAME_UNIFORM_OFFSETS, packFrameUniforms,
} from '../src/rendering/frame-uniforms';

describe('frame uniform contract', () => {
  it('packs every named field at its explicit aligned offset', () => {
    const matrix = Array.from({ length: 16 }, (_, index) => index + 1);
    const inverse = Array.from({ length: 16 }, (_, index) => index + 101);
    const packed = packFrameUniforms({
      viewProjection: matrix,
      inverseViewProjection: inverse,
      camera: [201, 202, 203, 204],
      sunTime: [301, 302, 303, 304],
      viewport: [401, 402, 403, 404],
      map: [501, 502, 503, 504],
      interaction: [601, 602, 603, 604],
      terrainInfo: [701, 702, 703, 704],
      lighting: [801, 802, 803, 804],
      sky: [901, 902, 903, 0],
      weather: [1, 0, 0, 0],
    });

    expect(packed).toHaveLength(FRAME_UNIFORM_FLOATS);
    expect(packed.byteLength).toBe(FRAME_UNIFORM_BYTES);
    expect([...packed.slice(FRAME_UNIFORM_OFFSETS.inverseViewProjection, FRAME_UNIFORM_OFFSETS.camera)])
      .toEqual(inverse);
    expect([...packed.slice(FRAME_UNIFORM_OFFSETS.sky, FRAME_UNIFORM_OFFSETS.weather)])
      .toEqual([901, 902, 903, 0]);
    expect([...packed.slice(FRAME_UNIFORM_OFFSETS.weather)]).toEqual([1, 0, 0, 0]);
  });

  it('rejects buffers and matrices that do not match the shader contract', () => {
    const valid = {
      viewProjection: new Float32Array(16), inverseViewProjection: new Float32Array(16),
      camera: [0, 0, 0, 0], sunTime: [0, 0, 0, 0], viewport: [0, 0, 0, 0], map: [0, 0, 0, 0],
      interaction: [0, 0, 0, 0], terrainInfo: [0, 0, 0, 0], lighting: [0, 0, 0, 0],
      sky: [0, 0, 0, 0], weather: [0, 0, 0, 0],
    } as const;
    expect(() => packFrameUniforms(valid, new Float32Array(64))).toThrow(/68 floats/);
    expect(() => packFrameUniforms({ ...valid, viewProjection: new Float32Array(15) })).toThrow(/16 floats/);
  });
});
