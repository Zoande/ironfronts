import { describe, expect, it } from 'vitest';
import { fixture, army } from '../helpers/simulation';
import { buildLandGraph, nearestNode } from '../../src/game/movement/graph';
import { issueMoveOrder, stepMovement } from '../../src/game/units/movement';
import { TERRAIN_CLASS } from '../../src/game/world-data';
import { issueAttack } from '../../src/game/commands/attack';

const edge = (ax: number, az: number, bx: number, bz: number): number[] => (
  [ax, az, bx, bz, 1, 0, 0, 0]
);

describe('terrain and diplomacy aware movement routing', () => {
  it('uses a longer legal route before considering a neutral shortcut', () => {
    const base = fixture();
    const graph = buildLandGraph(Float32Array.from([
      ...edge(100, 200, 300, 100), ...edge(300, 100, 500, 200),
      ...edge(100, 200, 250, 350), ...edge(250, 350, 400, 350),
      ...edge(400, 350, 500, 200),
    ]), base.world.width, base.world.height);
    const c = { ...base, graph, world: { ...base.world,
      provinceAt: (x: number, z: number) => z < 175 && x > 180 && x < 440 ? 11 : 10,
      terrainClassAt: () => TERRAIN_CLASS.plain } };
    c.state.provinceOwners = { 10: 1, 11: 3 };
    const start = nearestNode(c.graph, 100, 200);
    const lower = nearestNode(c.graph, 250, 350);
    c.state.armies.a = army('a', 1, 100, 200, start);

    const result = issueMoveOrder(c, 'a', 500, 200);

    expect(result.ok).toBe(true);
    expect(result.requiredWarCountryIds).toBeUndefined();
    expect(c.state.armies.a.order?.path).toContain(lower);
    expect(c.state.relations['1:3']).toBeUndefined();
  });

  it('chooses the faster terrain route instead of the geometrically tied route', () => {
    const base = fixture();
    const graph = buildLandGraph(Float32Array.from([
      ...edge(100, 200, 300, 100), ...edge(300, 100, 500, 200),
      ...edge(100, 200, 300, 300), ...edge(300, 300, 500, 200),
    ]), base.world.width, base.world.height);
    const c = { ...base, graph, world: { ...base.world,
      provinceAt: () => 10,
      terrainClassAt: (_x: number, z: number) => z < 200
        ? TERRAIN_CLASS.mountain : TERRAIN_CLASS.plain } };
    c.state.provinceOwners = { 10: 1 };
    const start = nearestNode(c.graph, 100, 200);
    const lower = nearestNode(c.graph, 300, 300);
    c.state.armies.a = army('a', 1, 100, 200, start);

    expect(issueMoveOrder(c, 'a', 500, 200).ok).toBe(true);
    expect(c.state.armies.a.order?.path).toContain(lower);
  });

  it('moves at 70 percent speed while physically inside enemy land', () => {
    const base = fixture();
    const graph = buildLandGraph(Float32Array.from([
      ...edge(100, 100, 500, 100), ...edge(100, 300, 500, 300),
    ]), base.world.width, base.world.height);
    const c = { ...base, graph, world: { ...base.world,
      provinceAt: (_x: number, z: number) => z < 200 ? 10 : 11,
      terrainClassAt: () => TERRAIN_CLASS.plain } };
    c.state.provinceOwners = { 10: 1, 11: 2 };
    c.state.relations['1:2'] = 'war';
    const own = c.state.armies.own = army('own', 1, 100, 100, nearestNode(c.graph, 100, 100));
    const enemy = c.state.armies.enemy = army('enemy', 1, 100, 300, nearestNode(c.graph, 100, 300));
    expect(issueMoveOrder(c, own.id, 500, 100).ok).toBe(true);
    expect(issueMoveOrder(c, enemy.id, 500, 300).ok).toBe(true);

    stepMovement(c, 0.1);

    expect(enemy.x - 100).toBeCloseTo((own.x - 100) * 0.7, 8);
  });

  it('captures an undefended enemy centre crossed while pursuing another army', () => {
    const base = fixture();
    const c = { ...base, world: { ...base.world,
      provinceAt: (x: number) => x < 200 ? 10 : x < 400 ? 11 : 13 } };
    c.state.provinceOwners = { 10: 1, 11: 2, 13: 2 };
    c.state.relations['1:2'] = 'war';
    const pursuer = c.state.armies.pursuer = army('pursuer', 1, 100, 100, 0);
    c.state.armies.target = army('target', 2, 500, 100, 3);
    expect(issueAttack(c, {
      type: 'attackArmy', countryId: 1, armyId: pursuer.id,
      target: { kind: 'army', armyId: 'target' },
    }).ok).toBe(true);

    const captures = stepMovement(c, 10);

    expect(captures).toContainEqual({ provinceId: 11, fromCountryId: 2, toCountryId: 1 });
    expect(c.state.provinceOwners[11]).toBe(1);
    expect(pursuer.order?.target).toMatchObject({ kind: 'army', armyId: 'target' });
  });
});
