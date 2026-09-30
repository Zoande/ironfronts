import { describe, expect, it } from 'vitest';
import { edgeFogOpacity, safeEdgeFogWidth } from '../src/rendering/edge-fog';

describe('Europe border fog', () => {
  it('uses the same maximum safe width on every edge', () => {
    const width = 5_935;
    const height = 3_950;
    const centers: Array<readonly [number, number]> = [
      [41, 1_600], [width - 16, 2_100], [2_900, 98], [3_100, height - 14],
      [width / 2, height / 2],
    ];
    const fadeWidth = safeEdgeFogWidth(width, height, centers);
    expect(fadeWidth).toBe(14);
    for (const [x, z] of centers) expect(edgeFogOpacity(x, z, width, height, fadeWidth)).toBe(0);
    for (const [x, z] of [[0, 1_600], [width, 2_100], [2_900, 0], [3_100, height]]) {
      expect(edgeFogOpacity(x, z, width, height, fadeWidth)).toBe(1);
    }
  });
});
