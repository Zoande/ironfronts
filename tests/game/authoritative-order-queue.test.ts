import {describe,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {army,fixture} from '../helpers/simulation';
import {applyCommand,advanceQueuedArmyOrders} from '../../src/game/commands';
import {stepMovement} from '../../src/game/units/movement';
import {GameSession} from '../../src/game/session/game-session';
import {parseGameState} from '../../src/game/state-schema';
import {GamePersistence} from '../../apps/game-server/src/persistence';
import {diffProjection,projectFor} from '../../apps/game-server/src/projection';
import {serverMessageSchema} from '../../packages/protocol/src/index';

function setup(){const c=fixture();c.state.armies.a=army();return c;}
const move=(x:number,enqueue=false)=>({type:'moveArmy' as const,countryId:1,armyId:'a',x,z:100,enqueue});

describe('authoritative army queues',()=>{
 it('starts an idle order immediately, then appends without replacing the active route',()=>{
  const c=setup();expect(applyCommand(c,move(300,true)).ok).toBe(true);
  expect(applyCommand(c,move(500,true)).ok).toBe(true);
  expect(c.state.armies.a.order?.destX).toBe(300);
  expect(c.state.armies.a.queuedOrders).toEqual([{kind:'move',x:500,z:100}]);
 });
 it('restores a saved queue and advances it with server ticks, without a connected client',()=>{
  const c=setup();applyCommand(c,move(300));applyCommand(c,move(500,true));
  const restored=GameSession.restore(parseGameState(JSON.parse(JSON.stringify(c.state))),c.world);
  for(let i=0;i<400 && restored.state.armies.a?.x!==500;i++)restored.tick(.1);
  expect(restored.state.armies.a?.x).toBeCloseTo(500,3);
  expect(restored.state.armies.a?.queuedOrders).toHaveLength(0);
 });
 it('leaves renewable extraction immediately instead of queuing forever',()=>{
  const c=setup();c.state.armies.a.status='extracting';
  expect(applyCommand(c,move(300,true)).ok).toBe(true);
  expect(c.state.armies.a.status).toBe('moving');
 });
 it('round-trips queues through the actual disk persistence envelope',async()=>{
  const c=setup();applyCommand(c,move(300));applyCommand(c,move(500,true));
  const dir=await mkdtemp(path.join(tmpdir(),'ironfronts-queue-'));
  try{const p=new GamePersistence(path.join(dir,'game.json'));
   await p.save({formatVersion:2,gameId:'world-at-war-2',gameVersion:'world-at-war@4',worldHash:'a'.repeat(64),savedAtEpochMs:Date.now(),gameStartedAtEpochMs:0,runtime:{version:2,state:c.state,seats:[['qa',1]]}});
   const loaded=await p.load();expect(loaded?.runtime.state.armies.a.queuedOrders).toEqual(c.state.armies.a.queuedOrders);
  }finally{await rm(dir,{recursive:true,force:true})}
 });
 it('checks ownership, finite bounds and a bounded queue before accepting orders',()=>{
  const c=setup();applyCommand(c,move(300));
  expect(applyCommand(c,{...move(500,true),countryId:2}).ok).toBe(false);
  expect(applyCommand(c,move(NaN,true)).ok).toBe(false);
  expect(applyCommand(c,move(3000,true)).ok).toBe(false);
  for(let i=0;i<32;i++)expect(applyCommand(c,move(500,true)).ok).toBe(true);
  expect(applyCommand(c,move(500,true))).toMatchObject({ok:false,reason:'Order queue is full (32 orders).'});
  expect(c.state.armies.a.queuedOrders).toHaveLength(32);
 });
 it('clears pending orders only after a successful replacement or stop',()=>{
  const c=setup();applyCommand(c,move(300));applyCommand(c,move(500,true));
  expect(applyCommand(c,move(100, false)).ok).toBe(false);
  expect(c.state.armies.a.queuedOrders).toHaveLength(1);
  expect(applyCommand(c,move(500, false)).ok).toBe(true);
  expect(c.state.armies.a.queuedOrders).toHaveLength(0);
  applyCommand(c,move(300));applyCommand(c,move(500,true));
  expect(applyCommand(c,{type:'stopArmy',countryId:1,armyId:'a'}).ok).toBe(true);
  expect(c.state.armies.a.queuedOrders).toHaveLength(0);
 });
 it('keeps the ordered stack separate from friendly troops at intermediate waypoints',()=>{
  const c=setup();c.state.armies.resident=army('resident',1,300,100,1);
  applyCommand(c,move(300));applyCommand(c,move(500,true));
  for(let i=0;i<100 && c.state.armies.a.status!=='idle';i++)stepMovement(c,.1);
  expect(c.state.armies.a).toBeDefined();expect(c.state.armies.resident).toBeDefined();
  advanceQueuedArmyOrders(c);expect(c.state.armies.a.order?.destX).toBe(500);
 });
 it('stops a stale attack once, exposes the error, and does not declare a new war',()=>{
  const c=setup();c.state.armies.enemy=army('enemy',2,500,100,3);
  applyCommand(c,move(300));
  expect(applyCommand(c,{type:'attackArmy',armyId:'a',countryId:1,target:{kind:'army',armyId:'enemy'},enqueue:true}).ok).toBe(true);
  delete c.state.armies.enemy;c.state.armies.a.status='idle';c.state.armies.a.order=null;
  advanceQueuedArmyOrders(c);
  expect(c.state.armies.a.queuedOrders).toHaveLength(0);
  expect(c.state.armies.a.queuedOrderError).toBeTruthy();
  expect(c.state.relations['1:2']).not.toBe('war');
  const error=c.state.armies.a.queuedOrderError;advanceQueuedArmyOrders(c);expect(c.state.armies.a.queuedOrderError).toBe(error);
 });
 it('keeps previous projections immutable so queue-only changes publish a delta',()=>{
  const c=setup();applyCommand(c,move(300));
  const before=projectFor(c.state,c.world,c.graph,1);
  applyCommand(c,move(500,true));
  const after=projectFor(c.state,c.world,c.graph,1);
  expect(before.armies.a.queuedOrders).toHaveLength(0);
  expect(after.armies.a.queuedOrders).toHaveLength(1);
  expect(diffProjection(before,after)?.upserts.armies?.a).toBeDefined();
 });
 it('projects queues only to their owner, and preserves them plus exact road endpoints on the wire',()=>{
  const c=setup();applyCommand(c,move(300));applyCommand(c,move(500,true));
  const own=projectFor(c.state,c.world,c.graph,1).armies.a;
  const foreign=projectFor(c.state,c.world,c.graph,2).armies.a;
  expect(own.queuedOrders).toHaveLength(1);expect(foreign?.queuedOrders).toBeUndefined();
  own.moveRoadRoute=[{edgeId:0,from:0,to:1,startDistance:0,endDistance:50}];
  const wire=serverMessageSchema.parse({type:'delta',fromRevision:0,revision:1,delta:{changed:{},upserts:{armies:{a:own}},removals:{},redactions:[]},events:[]});
  if(wire.type!=='delta')throw Error('Wrong message');
  expect((wire.delta.upserts.armies?.a as typeof own).moveRoadRoute?.[0].endDistance).toBe(50);
  expect((wire.delta.upserts.armies?.a as typeof own).queuedOrders).toHaveLength(1);
 });
});
