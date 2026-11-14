import {describe,expect,it} from 'vitest';
import {fixture} from '../helpers/simulation';
import {emptyStockpile,type ProvinceEconomy} from '../../src/game/game-state';
import {ensureWorldOpeningResourceBaseline,createProvinceEconomies} from '../../src/game/economy/resource-generation';
import {maximumResourceTier,BUILDING_FOR_RESOURCE,OPENING_RESOURCE_MIN_TIERS,PHYSICAL_RESOURCES} from '../../src/game/economy/resources';

function setup(){const c={...fixture()};c.world={...c.world,provinces:c.world.provinces.map(p=>({...p,urban:p.id===10}))};
 const economies:Record<number,ProvinceEconomy>=Object.fromEntries(c.world.provinces.map(p=>[p.id,{
  resourcePotential:{food:0,stone:0,metal:0,oil:0},baseProduction:emptyStockpile(),
  resourceBuildings:{fields:0,quarry:0,mine:0,oilPump:0},productionCapacity:1,constructionCapacity:1,
 }]));return {c,economies};}

describe('usable opening resource development',()=>{
 it('repairs an urban-only passive guarantee with rural development potential',()=>{
  const {c,economies}=setup();for(const r of PHYSICAL_RESOURCES)economies[10].baseProduction[r]=1;
  ensureWorldOpeningResourceBaseline(economies,c.world,[1]);
  for(const r of PHYSICAL_RESOURCES){const sites=c.world.provinces.filter(p=>!p.urban&&maximumResourceTier(BUILDING_FOR_RESOURCE[r],economies[p.id].resourcePotential[r])>=OPENING_RESOURCE_MIN_TIERS[r]);
   expect(sites.length,r).toBeGreaterThan(0);expect(economies[sites[0].id].baseProduction[r]).toBeGreaterThan(0);
  }
 });
 it('preserves rich natural sites and never gives free buildings, cash, or research',()=>{
  const {c,economies}=setup();for(const r of PHYSICAL_RESOURCES){economies[11].resourcePotential[r]=.98;economies[11].baseProduction[r]=2;}
  const before=structuredClone(economies);ensureWorldOpeningResourceBaseline(economies,c.world,[1]);expect(economies).toEqual(before);
 });
 it('is idempotent and does not replace a source lost through conquest',()=>{
  const {c,economies}=setup();ensureWorldOpeningResourceBaseline(economies,c.world,[1]);const before=structuredClone(economies);
  c.state.provinceOwners[11]=2;ensureWorldOpeningResourceBaseline(economies,c.world,[1]);expect(economies).toEqual(before);expect(c.state.provinceOwners[11]).toBe(2);
  expect(Object.values(economies).every(e=>Object.values(e.resourceBuildings).every(t=>t===0))).toBe(true);
 });
 it('uses the same guarantee during new-world creation',()=>{
  const {c}=setup();const e=createProvinceEconomies(c.world,123,[1]);
  for(const r of PHYSICAL_RESOURCES)expect(c.world.provinces.some(p=>!p.urban&&maximumResourceTier(BUILDING_FOR_RESOURCE[r],e[p.id].resourcePotential[r])>=OPENING_RESOURCE_MIN_TIERS[r])).toBe(true);
 });
});
