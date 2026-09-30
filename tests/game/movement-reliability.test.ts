import { describe, expect, it } from 'vitest';
import { army, fixture } from '../helpers/simulation';
import { buildLandGraph, edgePositionFrom } from '../../src/game/movement/graph';
import { stepMovement, issueMoveOrder, issueStop } from '../../src/game/units/movement';
import { revalidateOrder } from '../../src/game/movement/pursuit';
import { stepCombat } from '../../src/game/combat';
import { beginNavalCrossing } from '../../src/game/movement/naval';
import { wrappedDistance } from '../../src/game/geometry';
import { validateWorldState } from '../../src/game/state-invariants';
import type { CanonicalRoadNetwork } from '../../src/game/world-data';

function roads(points: number[][], pairs: number[][]): CanonicalRoadNetwork {
  return { version:1,
    nodes:points.map(([x,z],id) => ({id,sourceNodeId:id,x,z})),
    edges:pairs.map(([from,to],id) => ({id,from,to,length:Math.hypot(points[to][0]-points[from][0],points[to][1]-points[from][1]),pointOffset:id*2,pointCount:2,dotted:false})),
    centerlines:Float32Array.from(pairs.flatMap(([from,to]) => [...points[from],...points[to]])) };
}

describe('physical movement and combat boundaries', () => {
  it.each([0,0.005])('discards a junction edge at progress %s before pursuing down another road', (progress) => {
    const c=fixture(),a=army('a',1,100+progress,100,0),b=army('b',2,100,300,2);
    c.state.relations['1:2']='war';c.state.armies={a,b};
    a.edge={edgeId:0,from:0,to:1,distanceAlongEdge:progress};a.status='moving';
    a.order={path:[1,3],destX:500,destZ:100,intent:'attack',edgeProgress:progress,
      target:{kind:'army',armyId:'b',lastKnownX:500,lastKnownZ:100}};
    stepMovement(c,0.1);
    expect(a.x).toBe(100);expect(a.z).toBeCloseTo(109.45,8);
    expect(a.edge!.edgeId).toBe(1);
  });

  it('retains an exact road destination when ownership changes force a detour', () => {
    const c = {...fixture()};
    const network = roads([[100,100],[300,100],[700,100],[100,300],[300,300]],[[0,1],[1,2],[0,3],[3,4],[4,1]]);
    c.graph = buildLandGraph(new Float32Array(),2000,1000,network);
    c.world = {...c.world, roadNetwork:network, provinceAt:(x,z) => z<110 && x>150 && x<250 ? 11 : 10};
    const a = army(); c.state.armies.a = a;
    expect(issueMoveOrder(c,'a',600,100).ok).toBe(true);
    c.state.provinceOwners[11] = 3;
    revalidateOrder(c,a,a.order!);
    expect(a.order!.path).toEqual([3,4,1,2]);
    expect(a.order!.destX).toBe(600);
    stepMovement(c,20);
    expect(a.status).toBe('idle');
    expect(a.x).toBeCloseTo(600,8);
    expect(edgePositionFrom(c.graph,a.edge!.edgeId!,a.edge!.from,a.edge!.distanceAlongEdge!)).toEqual({x:a.x,z:a.z});
    const restored = {...c,state:structuredClone(c.state)};
    restored.state.nextFrontId=1;
    restored.state.nextDiplomacyId=1;
    validateWorldState(restored);
    expect(restored.state.armies.a.x).toBe(a.x);
  });

  it('repairs stale destination coordinates on restore and rejects a mismatched final road', () => {
    const c=fixture(),a=army();c.state.armies.a=a;
    c.state.nextFrontId=1;c.state.nextDiplomacyId=1;
    expect(issueMoveOrder(c,'a',190,100).ok).toBe(true);
    Object.assign(a.order!,{destX:300});
    validateWorldState(c);
    expect(a.order!.destX).toBe(190);
    Object.assign(a.order!.roadDestination!,{edgeId:1});
    expect(()=>validateWorldState(c)).toThrow('Invalid exact road destination');
  });

  it.each([190,170])('redirects directly from a stopped mid-edge position to x=%s', (destination) => {
    const c = fixture(); const a = army('a',1,180,100,0);
    a.edge = {edgeId:0,from:0,to:1,distanceAlongEdge:80}; c.state.armies.a = a;
    expect(issueStop(c,'a')).toBe(true);
    expect(issueMoveOrder(c,'a',destination,100).ok).toBe(true);
    stepMovement(c,0.01);
    expect(Math.sign(a.x-180)).toBe(Math.sign(destination-180));
    stepMovement(c,1);
    expect(a.x).toBe(destination);
    expect(a.status).toBe('idle');
  });

  it('clears the occupied edge when a direct redirect reaches an endpoint, then takes a different road', () => {
    const c=fixture(),a=army('a',1,180,100,0);
    a.edge={edgeId:0,from:0,to:1,distanceAlongEdge:80};c.state.armies.a=a;
    expect(issueMoveOrder(c,'a',100,100).ok).toBe(true);
    stepMovement(c,2);
    expect(a.edge).toBeNull();expect(a.graphNodeId).toBe(0);
    expect(issueMoveOrder(c,'a',100,200).ok).toBe(true);
    stepMovement(c,2);
    expect({x:a.x,z:a.z}).toEqual({x:100,z:200});
  });

  it('creates combat at a rounded swept contact instead of remaining stuck in moving', () => {
    const c = {...fixture()};
    const network = roads([[100,100],[300,100],[200.01,101.13],[400,101.13]],[[0,1],[2,3]]);
    c.graph = buildLandGraph(new Float32Array(),2000,1000,network);
    c.state.relations['1:2'] = 'war';
    const a = army('a'), b = army('b',2,200.01,101.13,2);
    a.status='moving'; a.order={path:[1],destX:300,destZ:100,intent:'attack',edgeProgress:0};
    c.state.armies={a,b};
    stepMovement(c,2); stepCombat(c,0);
    expect(wrappedDistance(a.x,a.z,b.x,b.z,c.world.width)).toBeCloseTo(26,9);
    expect(a.status).toBe('engaged');
    expect(Object.keys(c.state.battleFronts)).toHaveLength(1);
    const x=a.x;
    for(let tick=0;tick<10;tick++) {stepMovement(c,0.1/3600);stepCombat(c,0);}
    expect(a.x).toBe(x);
    expect(Object.keys(c.state.battleFronts)).toHaveLength(1);
  });

  it.each(['embarking','atSea','disembarking'] as const)('does not block land movement on an ineligible %s transport', (status) => {
    const c = {...fixture()};
    c.graph=buildLandGraph(new Float32Array([...c.world.connections,300,100,500,100,0,0,0,0]),2000,1000);
    c.state.relations['1:2']='war';
    const a=army('a'),b=army('b',2,300,100,1);
    a.status='moving';a.order={path:[1],destX:300,destZ:100,intent:'move',edgeProgress:0};
    c.state.armies={a,b};beginNavalCrossing(c,b,3);b.status=status;
    // Keep the transport fixed during this phase; only the land order advances.
    stepMovement(c,3);stepCombat(c,0);
    expect(a.x).toBe(300);
    expect(a.status).toBe('idle');
    expect(Object.keys(c.state.battleFronts)).toHaveLength(0);
  });

  it.each([110,110.13])('integrates terrain changes at x=%s independently of slice size', (boundary) => {
    const run=(steps:number) => {
      const c={...fixture()};c.world={...c.world,terrainClassAt:(x)=>x<boundary?0:2};
      const a=army();a.status='moving';a.order={path:[1],destX:300,destZ:100,intent:'move',edgeProgress:0};c.state.armies.a=a;
      for(let i=0;i<steps;i++)stepMovement(c,0.25/steps);
      return a.x;
    };
    const expected=boundary+(0.25-(boundary-100)/94.5)*94.5*0.48;
    expect(run(1)).toBeCloseTo(expected,5);
    expect(run(900)).toBeCloseTo(expected,5);
  });

  it('only charges a new fight for time remaining after swept contact', () => {
    const run=(steps:number) => {
      const c=fixture();c.state.relations['1:2']='war';
      const a=army('a',1,100,100,0,'infantry',1),b=army('b',2,145,100,0,'infantry',1);
      a.status='moving';a.order={path:[1],destX:300,destZ:100,intent:'attack',edgeProgress:0};
      b.edge={edgeId:0,from:0,to:1,distanceAlongEdge:45};c.state.armies={a,b};
      for(let i=0;i<steps;i++){
        const contacts=new Map<string,number>();stepMovement(c,0.25/steps,contacts);stepCombat(c,0.25/steps,contacts);
      }
      return b.units[0].hp;
    };
    const expected=100-(0.25-19/94.5)*75;
    expect(run(1)).toBeCloseTo(expected,8);
    // Damage effectiveness declines continuously in the smaller slices.
    expect(Math.abs(run(1)-run(900))).toBeLessThan(0.15);
  });

  it('uses the same contact time for every co-located defender joining a new front', () => {
    const c=fixture();c.state.relations['1:2']='war';
    const a=army('a',1,100,100,0,'infantry',1),b=army('b',2,145,100,0,'infantry',1),d=army('d',2,145,100,0,'infantry',1);
    a.status='moving';a.order={path:[1],destX:300,destZ:100,intent:'attack',edgeProgress:0};
    for(const defender of [b,d])defender.edge={edgeId:0,from:0,to:1,distanceAlongEdge:45};
    c.state.armies={a,b,d};const contacts=new Map<string,number>();
    stepMovement(c,0.25,contacts);stepCombat(c,0.25,contacts);
    expect(Object.keys(c.state.battleFronts)).toHaveLength(1);
    expect(b.units[0].hp).toBeCloseTo(100-(0.25-19/94.5)*75/2,8);
    expect(d.units[0].hp).toBe(b.units[0].hp);
  });
});
