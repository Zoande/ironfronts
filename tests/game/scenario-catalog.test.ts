import { describe, expect, it } from 'vitest';
import {
  SCENARIOS, buildScenarioSelection, isPlayableCountry, resolvePlayableCountries,
  scenarioById,
} from '../../src/game/scenario-catalog';
import {
  CATALOG_COUNTRIES, CATALOG_COUNTRY_BY_NAME,
} from '../../src/game/data/countries.generated';

const spainId = CATALOG_COUNTRY_BY_NAME.get('spain')!.id;

describe('scenario catalogue', () => {
  it('offers the World and Europe campaigns', () => {
    expect(SCENARIOS.map((scenario) => scenario.id)).toEqual(['OP-EUROPE-01', 'OP-1939-01']);
    expect(() => scenarioById('OP-1941-22')).toThrow(/Unknown scenario/);
    expect(() => scenarioById('SANDBOX')).toThrow(/Unknown scenario/);
  });

  it('World at War allows exactly the countries with at least five starting cities', () => {
    const worldAtWar = scenarioById('OP-1939-01');
    const playable = resolvePlayableCountries(worldAtWar);
    const expected = CATALOG_COUNTRIES.filter((country) => country.cityCount >= 5);
    expect(playable).toHaveLength(expected.length);
    expect(playable.length).toBeGreaterThan(0);
    expect(playable.every((country) => country.cityCount >= 5)).toBe(true);
    expect(isPlayableCountry(worldAtWar, spainId)).toBe(true);
    expect(playable.slice(0, 8).map((c) => c.name)).toContain('Germany');
  });

  it('buildScenarioSelection produces typed data and rejects illegal countries', () => {
    const selection = buildScenarioSelection('OP-1939-01', spainId);
    expect(selection).toEqual({
      scenarioId: 'OP-1939-01',
      theater: 'global',
      startDate: '1 Sep 1939',
      playerCountryId: spainId,
      sandbox: false,
    });
    const ineligible = CATALOG_COUNTRIES.find((country) => country.cityCount < 5);
    expect(ineligible).toBeDefined();
    expect(() => buildScenarioSelection('OP-1939-01', ineligible!.id)).toThrow(/not playable/);
  });
});
