import { describe, expect, it } from 'vitest';
import { fixture, army } from '../helpers/simulation';
import { initialTechnologyLevels } from '../../src/game/technology';
import { unitType, UNIT_TYPES } from '../../src/game/units/unit-catalog';
import { computeArmyVisibility } from '../../src/game/visibility';
import { stepCombat } from '../../src/game/combat';
import { applyCommand } from '../../src/game/commands';
import { stepMovement } from '../../src/game/units/movement';
import { navalLaunchPoint, waterRoute, clearWaterSegment } from '../../src/game/naval/navigation';
import { queueUnit, stepProduction, producibleUnits } from '../../src/game/production';
import { parseGameState } from '../../src/game/state-schema';
import { validateWorldState } from '../../src/game/state/state-invariants';
import { createTransportManifestation, transportHp } from '../../src/game/naval/transport';

function setup() {
  const c = fixture();
  Object.assign(c.world, {provinceAt: (x:number,z:number) => x < 600 && z >= 0 && z < 1000 ? 10 : -1});
  Object.assign(c.world, {provinces: c.world.provinces.map((p,i)=>i===0?{...p,coastal:true}:p)});
  Object.assign(c.state, {fogOfWar:true});
  c.state.relations['1:2'] = 'war';
  c.state.countries[1].technologies = initialTechnologyLevels();
  return c;
}
function ship(id: string, owner: number, x: number, type: string) {
  return {...army(id,owner,x,100,0,type,1),status:'atSea' as const};
}

describe('native fleet and stealth rules', () => {
  it('gives every troop all five damage classes and scales camouflage/reveal through level VIII', () => {
    for (const type of UNIT_TYPES) for (const profile of [type.attack,type.defense]) for (const armor of ['soft','light','heavy','ship','submarine'] as const) expect(profile[armor],`${type.id}/${armor}`).toBeGreaterThan(0);
    for (let level=1;level<=8;level++) {
      const suffix=level===1?'':`-l${level}`;
      expect(unitType(`submarine${suffix}`).camouflageLevel).toBe(level);
      expect(unitType(`militia${suffix}`).camouflageLevel).toBe(level);
      expect(unitType(`destroyer${suffix}`).revealLevel).toBe(level);
      expect(unitType(`armored-car${suffix}`).revealLevel).toBe(level);
    }
  });

  it('hides camouflage on owned land, reveals only matching levels inside detector vision, and expires firing reveals', () => {
    const c=setup();
    c.state.armies.m=army('m',2,300,100,1,'militia-l2',1);
    c.state.armies.r=army('r',1,100,100,0,'armored-car',1);
    expect(computeArmyVisibility(c.state,c.world,1).get('m')).toBe('hidden');
    c.state.armies.r.units[0]={typeId:'armored-car-l2',count:1,hp:unitType('armored-car-l2').maxHp,experience:0};
    expect(computeArmyVisibility(c.state,c.world,1).get('m')).not.toBe('hidden');
    c.state.armies.r.x=1000;
    expect(computeArmyVisibility(c.state,c.world,1).get('m')).toBe('hidden');
    c.state.armies.m.revealedUntilHours=1;
    expect(computeArmyVisibility(c.state,c.world,1).get('m')).toBe('contact');
    c.state.clock.gameTimeHours=1;
    expect(computeArmyVisibility(c.state,c.world,1).get('m')).toBe('hidden');
  });

  it('keeps submarines silent beside hostile ships until an attack order, then reveals firing and return fire', () => {
    const c=setup();
    c.state.armies.s=ship('s',1,700,'submarine');
    c.state.armies.b=ship('b',2,720,'battleship');
    stepCombat(c,.1);
    expect(c.state.armies.b.units[0].hp).toBe(700);
    expect(c.state.armies.s.units[0].hp).toBe(170);
    expect(computeArmyVisibility(c.state,c.world,2).get('s')).toBe('hidden');
    expect(applyCommand(c,{type:'attackArmy',countryId:1,armyId:'s',target:{kind:'army',armyId:'b'}}).ok).toBe(true);
    stepCombat(c,.1);
    expect(c.state.armies.b.units[0].hp).toBeLessThan(700);
    expect(c.state.armies.s.units[0].hp).toBeLessThan(170);
    expect(computeArmyVisibility(c.state,c.world,2).get('s')).not.toBe('hidden');
    expect(applyCommand(c,{type:'stopArmy',countryId:1,armyId:'s'}).ok).toBe(true);
    expect(c.state.armies.s.navalTargetArmyId).toBeNull();
  });

  it('lets destroyers reveal and engage submarines but outclassed sonar cannot see newer camouflage', () => {
    const c=setup(); c.state.armies.d=ship('d',1,700,'destroyer');c.state.armies.s=ship('s',2,720,'submarine-l2');
    stepCombat(c,.1);expect(c.state.armies.s.units[0].hp).toBe(unitType('submarine-l2').maxHp);
    c.state.armies.s=ship('s',2,720,'submarine');
    stepCombat(c,.1);expect(c.state.armies.s.units[0].hp).toBeLessThan(170);
    expect(c.state.armies.d.units[0].hp).toBeLessThan(300);
  });

  it('restricts coastal duels to normal contact distance and allows artillery versus ships', () => {
    const c=setup();c.state.armies.a=army('a',1,590,100,0,'infantry',1);c.state.armies.d=ship('d',2,620,'destroyer');
    stepCombat(c,.01);expect(c.state.armies.a.units[0].hp).toBe(100);
    c.state.armies.d.x=614;stepCombat(c,.01);expect(c.state.armies.a.units[0].hp).toBeLessThan(100);expect(c.state.armies.d.units[0].hp).toBeLessThan(300);
    c.state.armies.a=army('a',1,590,100,0,'artillery',1);c.state.armies.d.x=700;
    const hp=c.state.armies.d.units[0].hp;stepCombat(c,.01);expect(c.state.armies.d.units[0].hp).toBeLessThan(hp);
  });

  it('lets battleships bombard outside destroyer contact range without double firing at close range', () => {
    const c=setup();c.state.armies.b=ship('b',1,700,'battleship');c.state.armies.d=ship('d',2,800,'destroyer');
    stepCombat(c,.1);expect(c.state.armies.d.units[0].hp).toBeLessThan(300);expect(c.state.armies.b.units[0].hp).toBe(700);
    const near=setup();near.state.armies.b=ship('b',1,700,'battleship');near.state.armies.d=ship('d',2,720,'destroyer');
    stepCombat(near,.1);expect(near.state.armies.d.units[0].hp).toBeCloseTo(300-unitType('battleship').defense.ship!*.1);
  });

  it('damages fragile convoy hulls instead of applying land troop hit points at sea', () => {
    const c=setup();const transport=army('t',2,720,100,0,'medium-tank',1);transport.transport=createTransportManifestation(transport,1);transport.status='atSea';
    c.state.armies.t=transport;c.state.armies.d=ship('d',1,700,'destroyer');
    stepCombat(c,.02);
    expect(transportHp(transport.transport!)).toBeCloseTo(10-unitType('destroyer').defense.ship!*.02);
    expect(transport.units[0].hp).toBeCloseTo(transportHp(transport.transport!)/10*190);
  });

  it('routes fleets around islands, preserves water-only paths on reload, and rejects inland destinations', () => {
    const c=setup();Object.assign(c.world,{provinceAt:(x:number,z:number)=>x>850&&x<1050&&z<250?10:-1});
    const start={x:750,z:100}, goal={x:1150,z:100};
    const route=waterRoute(c.world,start,goal);expect(route?.length).toBeGreaterThan(1);
    let previous=start;for(const point of route!){expect(clearWaterSegment(c.world,previous,point)).toBe(true);previous=point;}
    c.state.armies.d=ship('d',1,start.x,'destroyer');
    expect(applyCommand(c,{type:'moveArmy',countryId:1,armyId:'d',...goal}).ok).toBe(true);
    stepMovement(c,.1);expect(c.world.provinceAt(c.state.armies.d.x,c.state.armies.d.z)).toBeLessThan(0);
    Object.assign(c.state,parseGameState(JSON.parse(JSON.stringify(c.state))));validateWorldState(c);
    expect(c.state.armies.d.transport).toBeNull();expect(c.state.armies.d.navalRoute?.length).toBeGreaterThan(0);
    expect(applyCommand(c,{type:'moveArmy',countryId:1,armyId:'d',x:950,z:100}).ok).toBe(false);
  });

  it('builds warships only at coastal ordnance works and launches them into water', () => {
    const c=setup();c.state.provinceBuildings[10].ordnance=1;
    for(const key of Object.keys(c.state.countries[1].stockpile)) (c.state.countries[1].stockpile as unknown as Record<string,number>)[key]=100000;
    expect(navalLaunchPoint(c.world,10)).not.toBeNull();
    expect(producibleUnits(c,10,1)).toContain('destroyer');
    expect(producibleUnits(c,11,1)).not.toContain('destroyer');
    expect(queueUnit(c,11,'destroyer',1).ok).toBe(false);
    expect(queueUnit(c,10,'destroyer',1).ok).toBe(true);
    const done=stepProduction(c,4);expect(done).toHaveLength(1);
    const fleet=c.state.armies[done[0].armyId];expect(fleet.status).toBe('atSea');expect(c.world.provinceAt(fleet.x,fleet.z)).toBeLessThan(0);
    Object.assign(c.state,parseGameState(c.state));validateWorldState(c);
  });
});
