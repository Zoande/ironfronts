import { describe, expect, it } from 'vitest';
import { closestReachablePath, shortestPaths } from '../../src/game/movement/pathfind';
import { SpatialIndex } from '../../src/game/spatial-index';
import type { LandGraph } from '../../src/game/movement/graph';

function grid(size: number): LandGraph {
  const count = size * size;
  const adjacency = Array.from({ length: count }, () => [] as number[]);
  const nodeX = new Float64Array(count), nodeZ = new Float64Array(count);
  for (let z=0; z<size; z++) for (let x=0; x<size; x++) {
    const id=z*size+x; nodeX[id]=x*10; nodeZ[id]=z*10;
    if (x) adjacency[id].push(id-1); if (x+1<size) adjacency[id].push(id+1);
    if (z) adjacency[id].push(id-size); if (z+1<size) adjacency[id].push(id+size);
  }
  const edgeCost = adjacency.map((neighbors) => neighbors.map(() => 10));
  return { nodeCount:count,nodeX,nodeZ,adjacency,edgeCost,component:new Int32Array(count),
    componentSize:[count],width:size*10,height:size*10,
    seaAdjacency:Array.from({length:count},()=>[]),seaEdgeCost:Array.from({length:count},()=>[]) } as unknown as LandGraph;
}

describe('simulation hot paths', () => {
  it('routes and queries a campaign-sized phase without quadratic fallback behavior', () => {
    const graph=grid(100);
    const started=performance.now();
    const paths=shortestPaths(graph,0);
    expect(paths.distance[9_999]).toBeGreaterThan(0);
    expect(closestReachablePath(graph,0,990,990).at(-1)).toBe(9_999);
    const values=Array.from({length:10_000},(_,id)=>({id,x:graph.nodeX[id],z:graph.nodeZ[id]}));
    const index=new SpatialIndex(values,graph.width);
    const nearby=index.query(500,500,25);
    expect(nearby.length).toBeLessThan(500);
    expect(performance.now()-started).toBeLessThan(2_000);
  });
});
