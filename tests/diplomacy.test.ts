import { describe, expect, it } from 'vitest';
import { buildDiplomacyColorData, findCountryByName } from '../src/rendering/diplomacy';
import type { CountryRecord, DiplomaticRelation } from '../src/rendering/types';

const countries: CountryRecord[] = [
  { id: 2, name: 'France', color: '#789abc', colorFamily: 0, capitalProvinceId: 1 },
  { id: 24, name: 'Spain', color: '#a07862', colorFamily: 1, capitalProvinceId: 2 },
  { id: 41, name: 'Portugal', color: '#879a72', colorFamily: 2, capitalProvinceId: 3 },
];

describe('diplomacy helpers', () => {
  it('resolves an exact country name without requiring matching case or surrounding whitespace', () => {
    expect(findCountryByName(countries, '  sPaIn ')).toEqual(countries[1]);
    expect(findCountryByName(countries, 'Spa')).toBeUndefined();
  });

  it('builds stable grey neutral colors and overrides war and allied countries', () => {
    const relations = new Map<number, DiplomaticRelation>([[2, 'war'], [41, 'allied']]);
    const colors = buildDiplomacyColorData(countries, relations, 24);
    expect(colors.length).toBe((41 + 1) * 4);
    expect([...colors.slice(2 * 4, 2 * 4 + 3)]).toEqual([184, 87, 82]);
    expect([...colors.slice(41 * 4, 41 * 4 + 3)]).toEqual([97, 140, 179]);
    const neutralColors = buildDiplomacyColorData(countries, new Map(), 2);
    const neutralSpain = [...neutralColors.slice(24 * 4, 24 * 4 + 3)];
    expect(Math.max(...neutralSpain) - Math.min(...neutralSpain)).toBeLessThanOrEqual(4);
    expect([...colors.slice(24 * 4, 24 * 4 + 3)]).toEqual([212, 176, 97]);
    expect(colors[24 * 4 + 3]).toBe(128);
    expect(colors[2 * 4 + 3]).toBe(255);
  });
});
