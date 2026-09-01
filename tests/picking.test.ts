import { describe, expect, it } from 'vitest';
import { gameplayProvinceId, resolvePrimaryClick } from '../src/picking';

describe('resolvePrimaryClick', () => {
  it('selects the province under a normal left-click', () => {
    expect(resolvePrimaryClick(7)).toEqual({ kind: 'select', encodedProvinceId: 7 });
  });

  it('clears the selection when the click misses any province', () => {
    expect(resolvePrimaryClick(0)).toEqual({ kind: 'clear-selection' });
  });

  it('never resolves a primary click to an ownership mutation', () => {
    for (const encodedId of [0, 1, 42, 999]) {
      const action = resolvePrimaryClick(encodedId);
      expect(['select', 'clear-selection']).toContain(action.kind);
    }
  });
});

describe('gameplayProvinceId', () => {
  it('decodes the texture id before an order reaches gameplay', () => {
    expect(gameplayProvinceId(1)).toBe(0);
    expect(gameplayProvinceId(42)).toBe(41);
    expect(gameplayProvinceId(0)).toBe(-1);
  });
});
