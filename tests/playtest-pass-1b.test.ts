import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameLobby, LobbyCountry } from '@ironfronts/protocol';
import { selectableCountries } from '../src/menu/lobby-state';
import { describeOrderFailure } from '../src/ui/order-feedback';

const root = process.cwd();

function lobby(countries: Partial<LobbyCountry>[]): GameLobby {
  return {
    gameId: 'g', name: 'n', gameVersion: 'v', protocolVersion: 5, assignedCountryId: null,
    countries: countries.map((c, i) => ({
      id: i + 1, name: 'X', color: '#fff', startingCities: 5, alive: true, claimed: false, ...c,
    })),
  };
}

describe('campaign-map country eligibility (#3)', () => {
  it('keeps every alive, unclaimed country with at least five cities', () => {
    const out = selectableCountries(lobby([
      { name: 'Germany', startingCities: 5 },
      { name: 'France', startingCities: 5 },
    ]));
    expect(out.map((c) => c.name).sort()).toEqual(['France', 'Germany']);
  });

  it('only drops sub-five-city, claimed, and dead countries', () => {
    const out = selectableCountries(lobby([
      { name: 'Germany', startingCities: 4 },              // too few cities
      { name: 'France', claimed: true },                   // taken
      { name: 'Italy', alive: false },                     // eliminated
      { name: 'California', startingCities: 5 },           // eligible without curation
      { name: 'Algeria', startingCities: 5 },              // eligible without curation
      { name: 'United Kingdom', startingCities: 5 },       // keeper
    ]));
    expect(out.map((c) => c.name)).toEqual(['California', 'Algeria', 'United Kingdom']);
  });
});

describe('order failure feedback (#5)', () => {
  const main = readFileSync(path.join(root, 'src/app/bootstrap.ts'), 'utf8');

  it.each([
    ['Target is not reachable.', 'Target is not reachable'],
    ['No valid hostile force.', 'No valid hostile force'],
    ['Attack route unavailable.', 'Attack route unavailable'],
    ['That destination is on a separate landmass.', 'Unreachable'],
    ['No legal route to that location.', 'No route'],
  ])('maps %s to a clear notification', (reason, title) => {
    expect(describeOrderFailure(reason)).toMatchObject({ title });
  });

  it('wires the tested mapper into server, right-click, and armed-button failures', () => {
    expect(main).toContain("import { describeOrderFailure } from '../ui/order-feedback'");
    expect(main.match(/describeOrderFailure\(/g)).toHaveLength(4);
    expect(main).not.toContain("pushNotification('warning', 'Command failed', reason)");
  });

  it('the movement engine distinguishes off-map / separate-landmass / no-route', () => {
    const mv = readFileSync(path.join(root, 'src/game/movement/orders.ts'), 'utf8');
    expect(mv).toContain('off the road network');
    expect(mv).toContain('separate landmass');
  });
});
