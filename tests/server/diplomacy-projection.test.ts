import { describe, expect, it } from 'vitest';
import type { CommandPayload } from '../../packages/protocol/src/index';
import { GameRuntime } from '../../apps/game-server/src/runtime';
import { diffProjection } from '../../apps/game-server/src/projection';
import type { WorldData, WorldProvince } from '../../src/game/world-data';

function tinyWorld(): WorldData {
  const provinces: WorldProvince[] = Array.from({ length: 12 }, (_, id) => ({
    id, center: [80 + id * 70, 100] as const, terrainId: 4, population: 10_000 - id,
    coastal: false, urban: true,
  }));
  const owners = Object.fromEntries(provinces.map((province) => [
    province.id, province.id < 5 ? 1 : province.id < 10 ? 2 : 3,
  ]));
  const edges: number[] = [];
  for (let id = 0; id < provinces.length - 1; id += 1) {
    edges.push(provinces[id].center[0], 100, provinces[id + 1].center[0], 100, 1, 0, 0, 0);
  }
  return {
    width: 1_200, height: 500, provinces,
    countries: [
      { id: 1, name: 'Alpha', color: '#aa0000', capitalProvinceId: 0 },
      { id: 2, name: 'Beta', color: '#0000aa', capitalProvinceId: 5 },
      { id: 3, name: 'Minor', color: '#888888', capitalProvinceId: 10 },
    ],
    provinceOwner: (id) => owners[id] ?? 0,
    provinceAt: (x) => Math.max(0, Math.min(11, Math.round((x - 80) / 70))),
    terrainClassAt: () => 4,
    connections: Float32Array.from(edges),
    resourceNodes: [],
  };
}

describe('private diplomacy projection', () => {
  it('reveals records only to their sender and recipient in deterministic order', () => {
    const runtime = new GameRuntime(tinyWorld());
    expect(runtime.join('account-a', 1).ok).toBe(true);
    expect(runtime.join('account-b', 2).ok).toBe(true);
    runtime.session.state.countries[3].controller = 'player';

    expect(runtime.command(1, {
      type: 'sendDiplomaticMessage', targetCountryId: 2, body: 'alpha to beta',
    }).ok).toBe(true);
    expect(runtime.command(2, {
      type: 'sendDiplomaticMessage', targetCountryId: 1, body: 'beta to alpha',
    }).ok).toBe(true);
    expect(runtime.command(2, {
      type: 'sendDiplomaticMessage', targetCountryId: 3, body: 'private from alpha',
    }).ok).toBe(true);
    expect(runtime.command(1, {
      type: 'proposeDiplomacy', targetCountryId: 2, proposal: 'alliance',
    }).ok).toBe(true);

    const alpha = runtime.projection(1);
    const beta = runtime.projection(2);
    const minor = runtime.projection(3);
    expect(alpha).not.toHaveProperty('outcome');
    expect(alpha.diplomacy?.messages.map((message) => message.body))
      .toEqual(['alpha to beta', 'beta to alpha']);
    expect(beta.diplomacy?.messages.map((message) => message.body))
      .toEqual(['alpha to beta', 'beta to alpha', 'private from alpha']);
    expect(minor.diplomacy?.messages.map((message) => message.body))
      .toEqual(['private from alpha']);
    expect(alpha.diplomacy?.proposals).toHaveLength(1);
    expect(minor.diplomacy?.proposals).toHaveLength(0);
  });

  it('diffs private diplomacy atomically in changed, never collection upserts', () => {
    const runtime = new GameRuntime(tinyWorld());
    runtime.join('account-a', 1);
    runtime.join('account-b', 2);
    const beforeAlpha = runtime.projection(1);
    const beforeMinor = runtime.projection(3);
    expect(runtime.command(1, {
      type: 'sendDiplomaticMessage', targetCountryId: 2, body: 'For your eyes only',
    }).ok).toBe(true);
    const alphaDelta = diffProjection(beforeAlpha, runtime.projection(1));
    const minorDelta = diffProjection(beforeMinor, runtime.projection(3));
    expect(alphaDelta?.changed.diplomacy?.messages).toHaveLength(1);
    expect(alphaDelta?.upserts).not.toHaveProperty('diplomacy');
    expect(alphaDelta?.removals).not.toHaveProperty('diplomacy');
    expect(minorDelta).toBeNull();
  });

  it('overwrites a forged runtime sender with the authenticated country id', () => {
    const runtime = new GameRuntime(tinyWorld());
    runtime.join('account-a', 1);
    runtime.join('account-b', 2);
    const forged = {
      type: 'sendDiplomaticMessage', targetCountryId: 2, body: 'Authenticated sender', countryId: 2,
    } as unknown as CommandPayload;
    expect(runtime.command(1, forged).ok).toBe(true);
    expect(Object.values(runtime.session.state.diplomacyMessages ?? {})[0]).toMatchObject({
      fromCountryId: 1, toCountryId: 2,
    });
  });
});
