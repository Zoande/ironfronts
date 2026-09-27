/**
 * World at War is currently the only available scenario. The catalogue and
 * typed selection pipeline remain data-driven so future scenarios can be added
 * without changing the menu -> GameSession boundary.
 */

import type { CatalogCountry } from './data/countries.generated';
import { CATALOG_COUNTRIES, CATALOG_COUNTRY_BY_NAME } from './data/countries.generated';
import type { ScenarioDef, ScenarioSelection } from './scenario';

export const SCENARIOS: readonly ScenarioDef[] = [
  {
    id: 'OP-EUROPE-01', name: 'Europe at War', theater: 'global', theaterLabel: 'Europe',
    startDate: '1 Sep 1939', mode: 'campaign', playableCountries: 'all',
    minimumStartingCities: 5, featuredCountries: ['Germany', 'France', 'United Kingdom', 'Italy', 'Poland'],
    fogOfWar: true, economyEnabled: true,
    blurb: 'Take command of a nation in the European theater.',
  },
  {
    id: 'OP-1939-01',
    name: 'World at War',
    theater: 'global',
    theaterLabel: 'Global',
    startDate: '1 Sep 1939',
    mode: 'campaign',
    playableCountries: 'all',
    minimumStartingCities: 5,
    featuredCountries: [
      'Germany', 'France', 'United Kingdom', 'Italy', 'Poland', 'Spain', 'Turkey', 'Japan',
    ],
    fogOfWar: true,
    economyEnabled: true,
    blurb: 'Coordinate a global mobilization and hold every theater at once.',
  },
];

export const SCENARIO_BY_ID: ReadonlyMap<string, ScenarioDef> =
  new Map(SCENARIOS.map((scenario) => [scenario.id, scenario]));

export function scenarioById(id: string): ScenarioDef {
  const scenario = SCENARIO_BY_ID.get(id);
  if (!scenario) throw new Error(`Unknown scenario: ${id}`);
  return scenario;
}

/**
 * Resolve a scenario's playable countries to concrete catalogue records,
 * ordered featured-first. The scenario's starting-city threshold is enforced
 * for both `'all'` and curated country lists.
 * Unknown names in a curated list are skipped (logged by the caller if needed).
 */
export function resolvePlayableCountries(scenario: ScenarioDef): CatalogCountry[] {
  const eligible = (country: CatalogCountry): boolean =>
    country.provinceCount > 0 && country.cityCount >= scenario.minimumStartingCities;
  if (scenario.playableCountries === 'all') {
    const featured = new Set(scenario.featuredCountries.map((name) => name.toLowerCase()));
    const playable = CATALOG_COUNTRIES.filter(eligible);
    return playable.sort((a, b) => {
      const af = featured.has(a.name.toLowerCase()) ? 0 : 1;
      const bf = featured.has(b.name.toLowerCase()) ? 0 : 1;
      if (af !== bf) return af - bf;
      return b.provinceCount - a.provinceCount;
    });
  }
  const seen = new Set<number>();
  const resolved: CatalogCountry[] = [];
  for (const name of scenario.playableCountries) {
    const country = CATALOG_COUNTRY_BY_NAME.get(name.toLowerCase());
    if (country && eligible(country) && !seen.has(country.id)) {
      seen.add(country.id);
      resolved.push(country);
    }
  }
  return resolved;
}

/** True when `countryId` is a legal player choice for the scenario (safety). */
export function isPlayableCountry(scenario: ScenarioDef, countryId: number): boolean {
  return resolvePlayableCountries(scenario).some((country) => country.id === countryId);
}

/** Build the typed menu -> game hand-off. Throws on an illegal country. */
export function buildScenarioSelection(
  scenarioId: string, playerCountryId: number,
): ScenarioSelection {
  const scenario = scenarioById(scenarioId);
  if (!isPlayableCountry(scenario, playerCountryId)) {
    throw new Error(
      `Country ${playerCountryId} is not playable in scenario ${scenarioId}.`,
    );
  }
  return {
    scenarioId,
    theater: scenario.theater,
    startDate: scenario.startDate,
    playerCountryId,
    sandbox: scenario.mode === 'sandbox',
  };
}
