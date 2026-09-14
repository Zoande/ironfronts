import { describe, expect, it } from 'vitest';
import { army, fixture } from '../helpers/simulation';
import { issueMoveOrder, issueStop, stepMovement, retreatPaths } from '../../src/game/units/movement';
import { stepCapture, stepCombat } from '../../src/game/combat';
import { cleanupFronts } from '../../src/game/combat/fronts';
import { issueExtract } from '../../src/game/extraction';
import { stepProduction } from '../../src/game/production';
import { issueAttack } from '../../src/game/commands/attack';
import { friendlyVisionSources } from '../../src/game/visibility';
import { makeGroup } from '../../src/game/units/army';
import { FIXED_STEP_HOURS } from '../../src/game/time';

describe('movement, diplomacy and combat invariants', () => {
  it('reverses through the current edge endpoint when redirected', () => {
    const c=fixture(); const a=c.state.armies.a=army('a',1,200,100);
    a.order={path:[1],destX:300,destZ:100,intent:'move',edgeProgress:100}; a.status='moving';
    expect(issueMoveOrder(c,'a',100,300).ok).toBe(true);
    stepMovement(c,1/1800); expect(a.x).toBeLessThan(200); expect(a.z).toBe(100);
  });
  it('requires physical arrival for capture, extraction and production stacking', () => {
    const c=fixture(); const a=c.state.armies.a=army('a',1,260,100);
    c.state.provinceOwners[10]=2;c.state.relations['1:2']='war';
    expect(stepCapture(c)).toEqual([]); c.state.provinceOwners[10]=1;
    c.state.resourceNodes[1]={id:1,kind:'metal',x:100,z:100,remaining:100,initialAmount:100,provinceId:10,accessNodeId:0,controllerCountryId:1,status:'idle',extractorArmyId:null,provenance:'generatedNatural'};
    expect(issueExtract(c,'a').ok).toBe(false);issueStop(c,'a');
    c.state.productionQueues[10]=[{id:'q',ownerCountryId:1,unitTypeId:'infantry',progressHours:0,totalHours:1/3600}];
    stepProduction(c,1/3600);expect(a.units[0].count).toBe(3);expect(Object.keys(c.state.armies)).toHaveLength(2);
  });
  it('treats no legal retreat exits as no routes', () => {
    const c=fixture();expect(retreatPaths(c,army(),[])).toEqual([]);
  });
  it('keeps pursuit intent for a contact between nodes', () => {
    const c=fixture();c.state.armies.a=army();const b=c.state.armies.b=army('b',2,180,100);
    b.order={path:[1],destX:300,destZ:100,intent:'move',edgeProgress:80};b.status='moving';c.state.relations['1:2']='war';
    expect(issueAttack(c,{type:'attackArmy',countryId:1,armyId:'a',target:{kind:'army',armyId:'b'}}).ok).toBe(true);
    expect(c.state.armies.a.order?.target?.kind).toBe('army');
  });
  it('requests all target and transit wars together without partial declarations', () => {
    const c=fixture();c.state.armies.a=army();c.state.armies.b=army('b',2,500,100,3);
    c.state.provinceOwners={10:1,11:3,12:1,13:2};
    Object.assign(c.world,{provinceAt:(x:number)=>x<200?10:x<400?11:13});
    const command={type:'attackArmy',countryId:1,armyId:'a',target:{kind:'army',armyId:'b'}} as const;
    expect(issueAttack(c,command).requiredWarCountryIds).toEqual([2,3]); expect(c.state.relations).toEqual({});
    expect(issueAttack(c,{...command,confirmedWarCountryIds:[2,3]}).ok).toBe(true);
    expect(c.state.relations).toEqual({'1:2':'war','1:3':'war'});
  });
  it('carries elapsed production time through multiple completed orders', () => {
    const c=fixture();c.state.productionQueues[10]=[1,2].map(id=>({id:String(id),ownerCountryId:1,unitTypeId:'infantry',progressHours:0,totalHours:1.5/1800}));
    expect(stepProduction(c,3/1800)).toHaveLength(2);expect(c.state.productionQueues[10]).toBeUndefined();
  });
  it('stops at enemy contact even with a large direct movement step', () => {
    const c=fixture();const a=c.state.armies.a=army('a',1,100,100,0,'armored-car');
    c.state.armies.b=army('b',2,160,100);c.state.relations['1:2']='war';
    issueMoveOrder(c,'a',300,100);stepMovement(c,1.5/1800);stepCombat(c,FIXED_STEP_HOURS);
    expect(a.x).toBeLessThan(160);expect(a.status).toBe('engaged');
  });
  it('clears a stale combat lock when its front no longer exists', () => {
    const c=fixture(); const a=c.state.armies.a=army('a');
    a.status='engaged'; a.battleFrontIds=['front-gone'];
    cleanupFronts(c, []);
    expect(a.battleFrontIds).toEqual([]);
    expect(a.status).toBe('idle');
  });
  it('ignores a front reference when the army is not on either combat side', () => {
    const c=fixture(); const a=c.state.armies.a=army('a');
    a.status='engaged'; a.battleFrontIds=['front-other'];
    c.state.battleFronts['front-other'] = {
      id: 'front-other', battleId: 'battle-1', anchorNodeId: 0, kind: 'road', provinceId: null,
      x: 100, z: 100,
      sideA: { countryId: 1, directionNodeId: 0, role: 'attack', armyIds: ['other'], entryMaxHpByArmy: { other: 100 } },
      sideB: { countryId: 2, directionNodeId: 1, role: 'defense', armyIds: ['enemy'], entryMaxHpByArmy: { enemy: 100 } },
    };
    expect(issueMoveOrder(c, 'a', 300, 100).ok).toBe(true);
    expect(a.status).toBe('moving');
  });
  it('never reuses an active front identifier after another front ends', () => {
    const c=fixture();c.state.armies.a=army();c.state.relations['1:2']='war';
    for(const [id,node] of [['b',1],['c',2],['d',3]] as const) {const a=c.state.armies[id]=army(id,2);a.lastGraphNodeId=node;}
    stepCombat(c,FIXED_STEP_HOURS);delete c.state.armies.c;stepCombat(c,FIXED_STEP_HOURS);
    const original=c.state.armies.d.battleFrontIds![0];c.state.armies.e=army('e',2);c.state.armies.e.lastGraphNodeId=0;
    stepCombat(c,FIXED_STEP_HOURS);
    expect(c.state.battleFronts[original].sideB.armyIds).toContain('d');
    expect(new Set(c.state.battles['battle-1'].frontIds).size).toBe(3);
  });
  it('retains the best reconnaissance capability of a mixed stack', () => {
    const c=fixture();const a=c.state.armies.a=army('a',1,100,100,0,'armored-car');
    a.units.push(makeGroup('medium-tank',1));expect(Math.sqrt(friendlyVisionSources(c.state,c.world,1)[0].outerSq)).toBe(300);
  });
});
