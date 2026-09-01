import { describe, expect, it } from 'vitest';
import { buildLandGraph } from '../../src/game/movement/graph';
import {
  bearingLabel, homelandCamera, orderRouteForClient, rallyRouteForClient, retreatExitsForClient,
} from '../../apps/game-server/src/projection';

describe('bearingLabel', () => {
  it('maps world deltas to an 8-point compass (north = -z, east = +x)', () => {
    expect(bearingLabel(0, -10)).toBe('N');
    expect(bearingLabel(10, 0)).toBe('E');
    expect(bearingLabel(0, 10)).toBe('S');
    expect(bearingLabel(-10, 0)).toBe('W');
    expect(bearingLabel(10, -10)).toBe('NE');
    expect(bearingLabel(-8, 8)).toBe('SW');
  });
});

describe('retreatExitsForClient', () => {
  const graph = {
    nodeX: [0, 100, 100, -100],
    nodeZ: [0, -100, -80, 100],
  };

  it('collapses per-province routes to one entry per distinct escape node', () => {
    const routes = [
      { firstNodeId: 1, destinationProvinceId: 10 },
      { firstNodeId: 1, destinationProvinceId: 11 },
      { firstNodeId: 1, destinationProvinceId: 12 },
      { firstNodeId: 3, destinationProvinceId: 20 },
      { firstNodeId: 1, destinationProvinceId: 13 },
    ];
    const exits = retreatExitsForClient(routes, graph, 100_000, 0, 0);
    expect(exits.map((e) => e.firstNodeId)).toEqual([1, 3]);
  });

  it('keeps the first (shortest, already sorted) destination for each node and tags a bearing', () => {
    const exits = retreatExitsForClient(
      [
        { firstNodeId: 1, destinationProvinceId: 10 },
        { firstNodeId: 1, destinationProvinceId: 11 },
        { firstNodeId: 3, destinationProvinceId: 20 },
      ],
      graph, 100_000, 0, 0,
    );
    expect(exits[0]).toMatchObject({ firstNodeId: 1, destinationProvinceId: 10, bearing: 'NE' });
    expect(exits[1]).toMatchObject({ firstNodeId: 3, destinationProvinceId: 20, bearing: 'SW' });
  });

  it('resolves the escape bearing across the world-x seam', () => {
    // Army near x=0, escape node at x=99_990 — really 10 units west, not far east.
    const exits = retreatExitsForClient(
      [{ firstNodeId: 0, destinationProvinceId: 1 }],
      { nodeX: [99_990], nodeZ: [0] }, 100_000, 5, 0,
    );
    expect(exits[0].bearing).toBe('W');
  });
});

describe('orderRouteForClient', () => {
  const graph = { nodeX: [10, 40, 40, 80], nodeZ: [0, 0, 30, 30] };

  it('prefixes the live army position and walks the remaining path nodes', () => {
    const route = orderRouteForClient({ path: [1, 2, 3] }, graph, 5, -2);
    expect(route).toEqual([
      { x: 5, z: -2 }, { x: 40, z: 0 }, { x: 40, z: 30 }, { x: 80, z: 30 },
    ]);
  });

  it('returns null for an order whose path has been consumed', () => {
    expect(orderRouteForClient({ path: [] }, graph, 0, 0)).toBeNull();
  });
});

describe('rallyRouteForClient', () => {
  // (0,0) - (200,0) - (400,0)
  const graph = buildLandGraph(new Float32Array([
    0, 0, 200, 0, 1, 0, 0, 0,
    200, 0, 400, 0, 1, 0, 0, 0,
  ]), 10_000, 5_000);
  const world = {
    width: 10_000, height: 5_000,
    provinces: [{ id: 7, center: [0, 0], terrainId: 4, population: 1, coastal: false, urban: true }],
  } as never;

  it('returns the road polyline from the province node to the rally node', () => {
    const route = rallyRouteForClient(world, graph, 7, { x: 395, z: 5 });
    expect(route && route.length).toBeGreaterThanOrEqual(2);
    expect(route![0]).toEqual({ x: 0, z: 0 });
    expect(route![route!.length - 1]).toEqual({ x: 400, z: 0 });
  });

  it('is null for an unknown province', () => {
    expect(rallyRouteForClient(world, graph, 999, { x: 0, z: 0 })).toBeNull();
  });
});

describe('homelandCamera', () => {
  it('frames the whole homeland, not just the capital, and pulls back for a larger country', () => {
    const compact = homelandCamera([[100, 100], [120, 110], [110, 130]], [100, 100], 10_000, 5_000);
    const sprawling = homelandCamera(
      [[100, 100], [900, 100], [1_700, 100], [900, 800]], [100, 100], 10_000, 5_000,
    );
    expect(sprawling.distance).toBeGreaterThan(compact.distance);
    // look-at sits between the capital and the far edge, not on the capital
    expect(sprawling.x).toBeGreaterThan(100);
    expect(sprawling.x).toBeLessThan(1_700);
  });

  it('unwraps a country that straddles the world-x seam', () => {
    const cam = homelandCamera(
      [[50, 100], [9_950, 100], [9_800, 100]], [50, 100], 10_000, 5_000,
    );
    // centroid of {50, -50, -200} around anchor 50 is ~ -66 -> wrapped to ~9934
    expect(cam.x).toBeGreaterThan(9_800);
  });

  it('falls back to the capital, then the map centre, with no owned land', () => {
    expect(homelandCamera([], [400, 250], 10_000, 5_000)).toMatchObject({ x: 400, z: 250 });
    expect(homelandCamera([], null, 10_000, 5_000)).toMatchObject({ x: 5_000, z: 2_500 });
  });
});
