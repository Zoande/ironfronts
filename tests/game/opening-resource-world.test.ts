import {describe,expect,it} from 'vitest';
import {loadWorld} from '../../apps/game-server/src/world-loader';
import {GameRuntime} from '../../apps/game-server/src/runtime';
import {maximumResourceTier,BUILDING_FOR_RESOURCE,OPENING_RESOURCE_MIN_TIERS,PHYSICAL_RESOURCES} from '../../src/game/economy/resources';
import {buildOptions} from '../../src/game/construction';

describe('compiled campaign opening economies',()=>{
 it('repairs a legacy campaign once while preserving seats, progress, armies and conquered land',async()=>{
  const {world}=await loadWorld('public/world');const rt=new GameRuntime(world);
  const country=rt.lobby().countries.find(c=>c.startingCities>=5&&c.alive)!;
  expect(rt.join('campaign-qa',country.id).ok).toBe(true);
  const snapshot=rt.snapshot();snapshot.state.clock.gameTimeHours=14*24;
  const original=world.provinces.filter(p=>!p.urban&&world.provinceOwner(p.id)===country.id).sort((a,b)=>a.id-b.id);
  for(const p of original)snapshot.state.provinceEconomies![p.id].resourcePotential.food=0;
  const captor=Object.keys(snapshot.state.countries).map(Number).find(id=>id!==country.id)!;
  snapshot.state.provinceOwners[original[0].id]=captor;
  const resources=structuredClone(snapshot.state.countries[country.id].stockpile);
  const restored=new GameRuntime(world,snapshot);
  expect(restored.seat('campaign-qa')).toBe(country.id);
  expect(restored.session.gameTimeHours).toBe(14*24);
  expect(Object.keys(restored.session.state.armies)).toEqual(Object.keys(snapshot.state.armies));
  expect(restored.session.state.countries[country.id].stockpile).toEqual(resources);
  expect(restored.session.state.provinceOwners[original[0].id]).toBe(captor);
  const migrated=structuredClone(restored.session.state.provinceEconomies);
  const again=new GameRuntime(world,restored.snapshot());
  expect(again.session.state.provinceEconomies).toEqual(migrated);
 },30000);

 it.each(['public/world','public/europe'])('gives every selectable country affordable rural development in %s',async directory=>{
  const {world}=await loadWorld(directory);const rt=new GameRuntime(world);
  const countries=rt.lobby().countries.filter(c=>c.startingCities>=5&&c.alive);
  expect(countries.length).toBeGreaterThan(0);
  for(const c of countries)for(const resource of PHYSICAL_RESOURCES){
   const building=BUILDING_FOR_RESOURCE[resource];
   const site=world.provinces.find(p=>!p.urban&&rt.session.state.provinceOwners[p.id]===c.id
    &&maximumResourceTier(building,rt.session.state.provinceEconomies![p.id].resourcePotential[resource])>=OPENING_RESOURCE_MIN_TIERS[resource]);
   expect(site,`${c.name}: ${resource} development site`).toBeDefined();
   expect(buildOptions(rt.session,site!.id,c.id).find(b=>b.id===building),`${c.name}: ${building} is buildable`).toMatchObject({affordable:true,targetTier:1});
  }
 },30000);
});
