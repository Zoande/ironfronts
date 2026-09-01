import type { GameLobby, LobbyCountry } from '@ironfronts/protocol';
import { resolveFlagUrl } from '../ui/flags';

/** Minimum starting cities for a country to appear in the curated picker. */
const MIN_STARTING_CITIES = 3;

/**
 * Temporary curated allow-list of nations offered in a New Campaign. The world
 * has ~100 eligible entities (real nations, colonies mapped to a metropole
 * flag, and fictional subdivisions); this trims the picker to sovereign 1939
 * powers a player would actually recognise and want to command. The server
 * still accepts any eligible country — this is a menu-only curation.
 *
 * Deliberately absent: the USSR is not a single world entity in this scenario
 * (it is split into Central Russia / Siberia / Ukraine / Belarus / Caucasus /
 * East Siberia with no unified period flag), so — like the split US/Canada
 * entities — it stays out rather than being faked. Every name below is verified
 * present in the shipped world.
 */
const CURATED_NATIONS = new Set<string>([
  'Germany', 'Italy', 'Japan', 'United Kingdom', 'France', 'Spain', 'Turkey',
  'Poland', 'Finland', 'Sweden', 'Romania', 'Yugoslavia', 'Greece', 'Bulgaria',
  'Czechoslovakia', 'Norway', 'Netherlands', 'Belgium', 'Portugal',
  'Switzerland', 'Austria', 'Denmark', 'Ireland',
  'Egypt', 'Ethiopia', 'Iraq', 'Saudi Arabia', 'Persia',
  'Nationalist China', 'Manchukuo', 'South Africa', 'New Zealand',
]);

export function assignedCountry(lobby: GameLobby): LobbyCountry | null {
  if (lobby.assignedCountryId === null) return null;
  return lobby.countries.find((country) => country.id === lobby.assignedCountryId) ?? null;
}

/**
 * Countries a new campaign may pick — a deliberate *curated* subset while the
 * roster is being designed. Alive, unclaimed, has a real period flag, has a few
 * starting cities, and is on the curated sovereign-nation list.
 */
export function selectableCountries(lobby: GameLobby): LobbyCountry[] {
  return lobby.countries.filter((country) =>
    country.alive
    && !country.claimed
    && country.startingCities >= MIN_STARTING_CITIES
    && CURATED_NATIONS.has(country.name)
    && resolveFlagUrl(country.name) !== null);
}
