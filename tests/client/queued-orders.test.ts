import {describe,expect,it} from 'vitest';
import {queuedRouteSegments} from '../../src/client/queued-orders';
import type {ProjectedArmy} from '@ironfronts/protocol';
const army=(overrides:Partial<ProjectedArmy>={})=>({id:'a',own:true,x:0,z:0,moveOrder:{x:100,z:0},queuedOrders:[{kind:'move',x:200,z:0}],...overrides}) as ProjectedArmy;
describe('queued destination arrows',()=>{
 it('draws queued intent from the active destination, including after a serialized reload',()=>{
  const a=army();const before=queuedRouteSegments(a,{},1000);
  expect(before[0].from).toEqual({x:100,z:0});
  expect(before.at(-1)?.to).toEqual({x:200,z:0});
  expect(queuedRouteSegments(JSON.parse(JSON.stringify(a)),{},1000)).toEqual(before);
 });
 it('never exposes foreign queues or hidden army targets',()=>{
  expect(queuedRouteSegments(army({own:false}),{},1000)).toEqual([]);
  const a=army({queuedOrders:[{kind:'attackArmy',targetArmyId:'hidden'}]});
  expect(queuedRouteSegments(a,{hidden:army({contact:'contact'})},1000)).toEqual([]);
 });
 it('draws the short wrapped route and bounds geometry for a full queue',()=>{
  const a=army({moveOrder:{x:990,z:0},queuedOrders:[{kind:'move',x:10,z:0}]});
  expect(queuedRouteSegments(a,{},1000).at(-1)?.to.x).toBe(1010);
  const full=army({queuedOrders:Array.from({length:32},(_,i)=>({kind:'move',x:i%2?10000:0,z:0}))});
  expect(queuedRouteSegments(full,{},20000).length).toBeLessThanOrEqual(1024);
 });
});
