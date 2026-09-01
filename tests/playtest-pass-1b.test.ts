import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameLobby, LobbyCountry } from '@ironfronts/protocol';
import { selectableCountries } from '../src/menu/lobby-state';

const root = process.cwd();

function lobby(countries: Partial<LobbyCountry>[]): GameLobby {
  return {
    gameId: 'g', name: 'n', gameVersion: 'v', protocolVersion: 2, assignedCountryId: null,
    countries: countries.map((c, i) => ({
      id: i + 1, name: 'X', color: '#fff', startingCities: 5, alive: true, claimed: false, ...c,
    })),
  };
}

describe('curated country selection (#3)', () => {
  it('keeps alive, unclaimed, ≥3-city countries that have a real flag', () => {
    const out = selectableCountries(lobby([
      { name: 'Germany', startingCities: 5 },
      { name: 'France', startingCities: 5 },
    ]));
    expect(out.map((c) => c.name).sort()).toEqual(['France', 'Germany']);
  });

  it('drops micro-states, claimed, dead, flag-less and non-curated entities', () => {
    const out = selectableCountries(lobby([
      { name: 'Germany', startingCities: 2 },              // too few cities
      { name: 'France', claimed: true },                   // taken
      { name: 'Italy', alive: false },                     // eliminated
      { name: 'California', startingCities: 5 },           // fictional, no flag
      { name: 'Algeria', startingCities: 5 },              // real colony, not a curated sovereign
      { name: 'United Kingdom', startingCities: 5 },       // keeper
    ]));
    expect(out.map((c) => c.name)).toEqual(['United Kingdom']);
  });
});

describe('order failure feedback (#5)', () => {
  const main = readFileSync(path.join(root, 'src/main.ts'), 'utf8');

  it('maps engine reasons to concise, specific headlines instead of "Command failed"', () => {
    const start = main.indexOf('function describeOrderFailure(');
    const body = main.slice(start, main.indexOf('\n}', start));
    for (const phrase of ['not your army', 'close combat', 'retreating', 'war declaration', 'no legal route', 'separate landmass']) {
      expect(body, phrase).toContain(phrase);
    }
    // The server-rejection path uses it now, not a flat string.
    expect(main).toContain('const { title, body } = describeOrderFailure(reason)');
    expect(main).not.toContain("pushNotification('warning', 'Command failed', reason)");
  });

  it('both the right-click and button order paths surface the reason', () => {
    // right-click path
    const rc = main.slice(main.indexOf('function handleMapCommand('), main.indexOf('function selectArmy('));
    expect(rc).toContain('describeOrderFailure');
    expect(rc).toContain("pushNotification('warning', 'No path there'");
    // armed-button path
    const bc = main.slice(main.indexOf('function handleMapClick('), main.indexOf('function handleMapCommand('));
    expect(bc).toContain('describeOrderFailure');
  });

  it('the movement engine distinguishes off-map / separate-landmass / no-route', () => {
    const mv = readFileSync(path.join(root, 'src/game/units/movement.ts'), 'utf8');
    expect(mv).toContain('off the road network');
    expect(mv).toContain('separate landmass');
  });
});
