import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildLandGraph, nearestNode } from '../../src/game/movement/graph';
import { findPath } from '../../src/game/movement/pathfind';

/** Stride-8 record: [x1,y1,x2,y2, medium(1=land), suppressed(1=no link), 0, 0]. */
function seg(x1: number, y1: number, x2: number, y2: number, land: boolean, suppressed = false): number[] {
  return [x1, y1, x2, y2, land ? 1 : 0, suppressed ? 1 : 0, 0, 0];
}

describe('water-crossing land connections are flagged untraversable', () => {
  it('registers a suppressed edge as nodes but never links it', () => {
    const conn = new Float32Array([
      ...seg(0, 0, 100, 0, true),                 // land A-B
      ...seg(100, 0, 200, 0, true, true),         // land B-C, corridor crosses water
      ...seg(200, 0, 300, 0, true),               // land C-D
    ]);
    const graph = buildLandGraph(conn, 4000, 2000);

    // Every endpoint still exists as a node (id stability).
    expect(graph.nodeCount).toBe(4);
    const b = nearestNode(graph, 100, 0);
    const c = nearestNode(graph, 200, 0);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(c).toBeGreaterThanOrEqual(0);

    // …but B and C are not linked, so the mainland splits at the water gap.
    expect(graph.adjacency[b]).not.toContain(c);
    expect(graph.adjacency[c]).not.toContain(b);
    expect(graph.component[b]).not.toBe(graph.component[c]);
    expect(findPath(graph, b, c)).toBeNull();
  });

  it('routes a path around a suppressed edge when an alternative exists', () => {
    const conn = new Float32Array([
      ...seg(0, 0, 100, 0, true),                 // A-B
      ...seg(100, 0, 200, 0, true, true),         // B-C direct: crosses water
      ...seg(100, 0, 150, 120, true),             // B-E detour
      ...seg(150, 120, 200, 0, true),             // E-C detour
    ]);
    const graph = buildLandGraph(conn, 4000, 2000);
    const b = nearestNode(graph, 100, 0);
    const c = nearestNode(graph, 200, 0);
    const e = nearestNode(graph, 150, 120);

    const route = findPath(graph, b, c);
    expect(route).not.toBeNull();
    expect(route).toContain(e);
    // never the direct hop
    for (let i = 1; i < route!.length; i += 1) {
      expect(!(route![i - 1] === b && route![i] === c)).toBe(true);
    }
  });

  it('leaves node identities and coordinates byte-for-byte stable vs an un-audited build', async () => {
    // The audit must only thin adjacency — never renumber nodes — or a live
    // save's army.graphNodeId / MoveOrder.path would silently point elsewhere.
    const WORLD_DIR = path.resolve(__dirname, '../../public/world');
    const manifest = JSON.parse(await readFile(path.join(WORLD_DIR, 'world.json'), 'utf8'));
    const bytes = await readFile(path.join(WORLD_DIR, 'connections.f32'));
    const raw = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    const audited = raw.slice();
    const unaudited = raw.slice();
    for (let offset = 0; offset + 8 <= unaudited.length; offset += 8) unaudited[offset + 5] = 0;

    const a = buildLandGraph(audited, manifest.world.width, manifest.world.height);
    const u = buildLandGraph(unaudited, manifest.world.width, manifest.world.height);

    expect(a.nodeCount).toBe(u.nodeCount);
    expect(Array.from(a.nodeX)).toEqual(Array.from(u.nodeX));
    expect(Array.from(a.nodeZ)).toEqual(Array.from(u.nodeZ));

    const edges = (g: typeof a): number => g.adjacency.reduce((sum, list) => sum + list.length, 0);
    // Audited build links no more than the raw one; if the shipped world has
    // any flagged crossings it links strictly fewer.
    expect(edges(a)).toBeLessThanOrEqual(edges(u));
  });
});
