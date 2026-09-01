import type { GameLobby, LobbyCountry } from '@ironfronts/protocol';
/** Campaign command requires a country with at least five starting cities. */
export const MIN_STARTING_CITIES = 5;

export function assignedCountry(lobby: GameLobby): LobbyCountry | null {
  if (lobby.assignedCountryId === null) return null;
  return lobby.countries.find((country) => country.id === lobby.assignedCountryId) ?? null;
}

/**
 * Countries a new campaign may pick. Every country remains visible on the map;
 * this function only decides whether it can receive the player's command.
 */
export function selectableCountries(lobby: GameLobby): LobbyCountry[] {
  return lobby.countries.filter((country) =>
    country.alive
    && !country.claimed
    && country.startingCities >= MIN_STARTING_CITIES);
}
