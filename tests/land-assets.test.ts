import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LAND_CLIPS } from '../src/rendering/land-model';
import { LAND_FIRE_PHASE, LAND_FIRE_PERIODS, landMuzzlePosition, nextLandShot } from '../src/rendering/land-animation';
import { CombatEffectPool, EFFECT_KIND, EFFECT_STRIDE } from '../src/rendering/combat-effects';

function asset(family:string,lod:number) {
  const data=readFileSync(`public/models/land/${family}-lod${lod}.glb`);
  expect(data.readUInt32LE(0)).toBe(0x46546c67);
  expect(data.readUInt32LE(4)).toBe(2);
  return JSON.parse(data.subarray(20,20+data.readUInt32LE(12)).toString('utf8'));
}

describe('original resident land assets',()=>{
  for(const family of ['infantry','armored-car','tank','artillery'])it(`${family} has complete compatible LODs and animation sockets`,()=>{
    let lastTriangles=Infinity;
    let jointNames:string[]=[];
    for(let lod=0;lod<3;lod++){
      const glb=asset(family,lod);
      const primitive=glb.meshes[0].primitives[0];
      expect(glb.meshes[0].primitives).toHaveLength(1);
      const triangles=glb.accessors[primitive.indices].count/3;
      expect(triangles).toBeLessThan(lastTriangles);
      expect(triangles).toBeGreaterThan(500);
      expect(triangles).toBeLessThan(65000);
      lastTriangles=triangles;
      expect(glb.animations.map((clip:{name:string})=>clip.name).sort()).toEqual([...LAND_CLIPS].sort());
      const names=glb.skins[0].joints.map((index:number)=>glb.nodes[index].name);
      expect(names).toContain('Muzzle');
      expect(names.length).toBeLessThan(256); // packed uint8 joints on the GPU
      if(lod===0)jointNames=names;else expect(names).toEqual(jointNames);
      for(const attribute of ['POSITION','NORMAL','TEXCOORD_0','JOINTS_0','WEIGHTS_0'])expect(primitive.attributes[attribute]).toBeDefined();
      expect(glb.images??[]).toHaveLength(0); // textures shared, never repeated in each GLB
    }
    expect(existsSync(`material/land-armies/${family}.blend`)).toBe(true);
  });
});

describe('weapon choreography',()=>{
  it('shares the exact GPU fire phase and skips rifle reload cycles',()=>{
    for(let kind=0;kind<4;kind++)for(const now of [0,1.2,12.7,104]){
      const shot=nextLandShot(now,.23,kind);
      expect(shot.at).toBeGreaterThanOrEqual(now-1e-9);
      expect(shot.at/LAND_FIRE_PERIODS[kind]+.23-shot.cycle).toBeCloseTo(LAND_FIRE_PHASE);
      if(kind===0)expect(shot.cycle%4).not.toBe(3);
    }
  });
  it('rotates a muzzle around the turret pivot independently of its hull',()=>{
    const point=landMuzzlePosition(10,20,Math.PI/2,[0,2,3],2,[0,1,1],0);
    expect(point.x).toBeCloseTo(14);
    expect(point.z).toBeCloseTo(18);
    expect(point.height).toBe(4);
  });
  it('keeps the projectile endpoint and impact time aligned for different ranges',()=>{
    const pool=new CombatEffectPool(128);
    pool.spawnWeaponShot(2,10,20,40,60,{now:1000,height:3});
    const initial=pool.collect(1000,{x:10,z:20},10000);
    const projectile=Array.from({length:initial.count},(_,i)=>i*EFFECT_STRIDE).find(o=>initial.floats[o+2]===EFFECT_KIND.projectile)!;
    expect(initial.floats[projectile+8]).toBe(3);
    expect(initial.floats[projectile+9]).toBe(50);
    expect(pool.collect(1319,{x:10,z:20},10000).floats[2]).not.toBe(EFFECT_KIND.impact);
    const landed=pool.collect(1320,{x:10,z:20},10000);
    const impact=Array.from({length:landed.count},(_,i)=>i*EFFECT_STRIDE).find(o=>landed.floats[o+2]===EFFECT_KIND.impact)!;
    expect(landed.floats[impact]).toBe(40);expect(landed.floats[impact+1]).toBe(60);
    expect(Array.from({length:landed.count},(_,i)=>landed.floats[i*EFFECT_STRIDE+2])).not.toContain(EFFECT_KIND.projectile);
  });
});
