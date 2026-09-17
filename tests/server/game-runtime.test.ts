import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GameRuntime } from '../../apps/game-server/src/runtime';
import { GamePersistence } from '../../apps/game-server/src/persistence';
import { diffProjection, projectFor } from '../../apps/game-server/src/projection';
import type { WorldData, WorldProvince } from '../../src/game/world-data';

function tinyWorld(): WorldData {
  const provinces: WorldProvince[] = Array.from({ length: 12 }, (_, id) => ({
    id, center: [80 + id * 70, 100] as const, terrainId: 4, population: 10_000 - id,
    coastal: false, urban: true,
  }));
  const owners = Object.fromEntries(provinces.map((province) => [province.id, province.id < 5 ? 1 : province.id < 10 ? 2 : 3]));
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

describe('single authoritative game runtime', () => {
  it('selects five-city countries, initializes them equally, and assigns seats atomically', () => {
    const runtime = new GameRuntime(tinyWorld());
    // The lobby map includes the ineligible minor in grey; join remains gated.
    expect(runtime.lobby().countries.map((country) => country.id)).toEqual([1, 2, 3]);
    expect(runtime.session.state.countries[1].stockpile).toEqual(runtime.session.state.countries[2].stockpile);
    expect(Object.values(runtime.session.state.armies).filter((army) => army.ownerCountryId === 1)).toHaveLength(4);
    expect(Object.values(runtime.session.state.armies).filter((army) => army.ownerCountryId === 2)).toHaveLength(4);
    expect(runtime.join('account-a', 1)).toEqual({ ok: true, countryId: 1 });
    expect(runtime.join('account-b', 1)).toMatchObject({ ok: false });
    expect(runtime.join('account-a', 2)).toMatchObject({ ok: false });
    expect(runtime.join('account-b', 3)).toMatchObject({ ok: false });
    expect(runtime.seat('account-a')).toBe(1);
  });

  it('projects private state per viewer and emits change-only removals/redactions', () => {
    const runtime = new GameRuntime(tinyWorld());
    const before = projectFor(runtime.session.state, runtime.world, runtime.session.graph, 1);
    expect(before.ownCountry?.id).toBe(1);
    expect(Object.keys(before.provinceBuildings).every((id) => before.provinceOwners[Number(id)] === 1)).toBe(true);
    const foreign = Object.values(runtime.session.state.armies).find((army) => army.ownerCountryId === 2)!;
    foreign.x = 1_100;
    foreign.z = 450;
    const after = projectFor(runtime.session.state, runtime.world, runtime.session.graph, 1);
    const delta = diffProjection(before, after);
    if (before.armies[foreign.id]) {
      expect(delta?.removals.armies).toContain(foreign.id);
      expect(delta?.redactions).toContain(`armies.${foreign.id}`);
    }
    expect(after.ownCountry).not.toHaveProperty('password');
  });

  it('keeps advancing with no connected clients', () => {
    const runtime = new GameRuntime(tinyWorld());
    runtime.tick(1 / 1800);
    expect(runtime.session.gameTimeHours).toBeCloseTo(1 / 1800);
  });

  it('projects the next movement waypoint with a sim-speed-aware wall-clock ETA', () => {
    const runtime = new GameRuntime(tinyWorld());
    const army = Object.values(runtime.session.state.armies).find((candidate) => candidate.ownerCountryId === 1)!;
    const targetNode = runtime.session.graph.adjacency[army.graphNodeId][0];
    const finalNode = runtime.session.graph.adjacency[targetNode]
      .find((node) => node !== army.graphNodeId) ?? targetNode;
    army.order = {
      path: [targetNode, finalNode],
      destX: runtime.session.graph.nodeX[finalNode],
      destZ: runtime.session.graph.nodeZ[finalNode],
      intent: 'move',
      edgeProgress: 0,
    };
    army.status = 'moving';
    army.order.edgeProgress = 10;
    const normal = runtime.projection(1, 1).armies[army.id].motion!;
    const fast = runtime.projection(1, 2).armies[army.id].motion!;
    const normalArrival = runtime.projection(1, 1).armies[army.id].arrival!;
    const fastArrival = runtime.projection(1, 2).armies[army.id].arrival!;
    expect(normal.targetX).toBe(runtime.session.graph.nodeX[targetNode]);
    expect(normal.targetZ).toBe(runtime.session.graph.nodeZ[targetNode]);
    expect(normal.durationMs).toBeGreaterThan(0);
    expect(normal.progress).toBeGreaterThan(0);
    expect(fast.durationMs).toBeCloseTo(normal.durationMs / 2);
    expect(normalArrival.remainingMs).toBeGreaterThan(normal.durationMs);
    expect(fastArrival.remainingMs).toBeCloseTo(normalArrival.remainingMs / 2);
  });

  it('projects authoritative embark timing at the active simulation speed', () => {
    const runtime = new GameRuntime(tinyWorld());
    const army = Object.values(runtime.session.state.armies).find((candidate) => candidate.ownerCountryId === 1)!;
    const targetNode = runtime.session.graph.adjacency[army.graphNodeId][0];
    army.order = {
      path: [targetNode], destX: runtime.session.graph.nodeX[targetNode],
      destZ: runtime.session.graph.nodeZ[targetNode], intent: 'move', edgeProgress: 0,
    };
    army.status = 'embarking';
    army.navalCrossing = { fromNodeId: army.graphNodeId, toNodeId: targetNode, hoursRemaining: 0.25 };
    const normal = runtime.projection(1, 1).armies[army.id].navalPhase!;
    const fast = runtime.projection(1, 2).armies[army.id].navalPhase!;
    expect(normal).toMatchObject({ kind: 'embarking', durationMs: 1_800_000, remainingMs: 900_000 });
    expect(fast.durationMs).toBe(normal.durationMs / 2);
    expect(fast.remainingMs).toBe(normal.remainingMs / 2);
  });

  it('projects detached authoritative province capabilities', () => {
    const runtime = new GameRuntime(tinyWorld());
    const provinceId = Number(Object.keys(runtime.session.state.provinceBuildings).find((id) =>
      runtime.session.state.provinceOwners[Number(id)] === 1)!);
    const first = runtime.projection(1).provinceActions[provinceId];
    expect(first.production.some((option) => option.available)).toBe(true);
    expect(first.construction.every((option) => typeof option.available === 'boolean')).toBe(true);
    expect(first.canSetRally).toBe(true);
    runtime.session.state.countries[1].stockpile.funds = 0;
    const second = runtime.projection(1).provinceActions[provinceId];
    expect(second.production.filter((option) => option.available).some((option) => !option.affordable)).toBe(true);
    (second.production as Array<unknown>).splice(0);
    expect(runtime.projection(1).provinceActions[provinceId].production.length).toBeGreaterThan(0);
  });

  it('applies validated authoritative debug cheats', () => {
    const runtime = new GameRuntime(tinyWorld());
    expect(runtime.cheatBuild(0, 'barracks', 5)).toMatchObject({ ok: true });
    expect(runtime.session.state.provinceBuildings[0].barracks).toBe(5);
    const beforeArmies = Object.keys(runtime.session.state.armies).length;
    expect(runtime.cheatSpawnUnit(0, 2, 'medium-tank')).toMatchObject({ ok: true });
    expect(Object.keys(runtime.session.state.armies)).toHaveLength(beforeArmies + 1);
    const beforeFunds = runtime.session.state.countries[2].stockpile.funds;
    expect(runtime.cheatGiveResource(2, 'funds', 1234.5)).toMatchObject({ ok: true });
    expect(runtime.session.state.countries[2].stockpile.funds).toBe(beforeFunds + 1234.5);
    expect(runtime.cheatBuild(999, 'mine', 5)).toMatchObject({ ok: false });
  });

  it('round-trips authoritative state and permanent seats through game.json', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ironfronts-game-'));
    const persistence = new GamePersistence(path.join(directory, 'game.json'));
    try {
      const runtime = new GameRuntime(tinyWorld());
      expect(runtime.join('account-a', 1)).toMatchObject({ ok: true });
      runtime.session.state.provinceOwners[5] = 1;
      runtime.tick(2 / 1800);
      await persistence.save({
        formatVersion: 2,
        gameId: 'world-at-war-2',
        gameVersion: 'world-at-war@2',
        worldHash: 'test-world',
        savedAtEpochMs: 2_000,
        gameStartedAtEpochMs: 1_000,
        runtime: runtime.snapshot(),
      });
      const saved = await persistence.load();
      const restored = new GameRuntime(tinyWorld(), saved!.runtime);
      expect(restored.seat('account-a')).toBe(1);
      expect(restored.session.gameTimeHours).toBeCloseTo(2 / 1800, 5);
      expect(restored.session.state.countries[1].controller).toBe('player');
      expect(restored.session.state.provinceOwners[5]).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
