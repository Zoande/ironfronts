/** Real WebGPU asset/animation verification in an isolated renderer, no account or campaign. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
const origin=process.argv[2] ?? 'http://127.0.0.1:5173';
const output=new URL('../../artifacts/land-armies/',import.meta.url);
await mkdir(output,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.IRONFRONTS_BROWSER ?? '/usr/bin/chromium',headless:true,
  args:['--enable-unsafe-webgpu','--enable-features=Vulkan','--use-vulkan=swiftshader','--use-angle=swiftshader',...(process.env.IRONFRONTS_NO_SANDBOX==='true'?['--no-sandbox']:[])]});
try {
  const page=await browser.newPage({viewport:{width:1000,height:700}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'||message.text().includes('Could not load'))errors.push(message.text());});
  await page.route(`${origin}/__fleet-qa`,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><style>body{margin:0}canvas{width:100vw;height:100vh}</style><canvas></canvas>'}));
  await page.goto(`${origin}/__fleet-qa`);
  const loaded=await page.evaluate(async()=>{
    const {WorldRenderer}=await import('/src/rendering/renderer.ts');
    const r=new WorldRenderer(document.querySelector('canvas'),undefined,'medium');
    window.fleetRenderer=r;
    await r.initialize(()=>{});
    r.setTimeOfDay(13);r.setTimeMultiplier(0);r.setFrameRateCap(12);
    r.setCountryOverlayVisible(false);r.setPerformanceLayerVisibility({trees:false,buildings:false});
    r.camera.minimumAltitude=20;r.camera.minDistance=30;
    return r.landUnits.map(unit=>({family:unit.family,loaded:!!unit.model,lods:unit.model?.lods.length}));
  });
  assert.equal(loaded.length,11);
  assert.ok(loaded.every(unit=>unit.loaded&&unit.lods===3),JSON.stringify(loaded));
  console.log(JSON.stringify({loaded}));
  for (const scene of ['land','fleet']) {
    const report=await page.evaluate(scene=>{
      const r=window.fleetRenderer;
      let center=scene==='land' ? [r.manifest.showcases.dirtRoad[0]+65,r.manifest.showcases.dirtRoad[1]+25] : null;
      if (!center) {
        const [cx,cz]=r.manifest.showcases.dirtRoad;
        for(let radius=100;radius<=3000&&!center;radius+=100)for(let angle=0;angle<32&&!center;angle++) {
          const x=cx+Math.cos(angle*Math.PI/16)*radius,z=cz+Math.sin(angle*Math.PI/16)*radius;
          if ([[0,0],[100,0],[-100,0],[0,100],[0,-100]].every(([dx,dz])=>r.sampleProvince(x+dx,z+dz)===0)) center=[x,z];
        }
      }
      if (!center) throw new Error('No clear water found');
      const [x,z]=center;
      const kinds=scene==='land'?[0,6,7,1,8,2,3]:[5,9,10,11];
      const models=new Float32Array(kinds.length*16);
      kinds.forEach((kind,i)=>{
        const px=x+(i-(kinds.length-1)/2)*(scene==='land'?18:35),pz=z;
        models.set([px,pz,0x547b80,kind,1,1,scene==='fleet'?2:8,.2,0,i*.071,0,.2,px,pz,0,0],i*16);
      });
      r.setArmyMarkers(new Float32Array(28),0,[],models,kinds.length);
      r.focus(x,z,scene==='land'?150:210,-.35,.95);
      r.start();
      return {scene,kinds,center};
    },scene);
    await page.waitForTimeout(2400);
    const visible=await page.evaluate(()=>{
      const r=window.fleetRenderer;r.stop();
      return r.landUnits.filter(unit=>unit.layer.count>0).map(unit=>unit.kind);
    });
    for (const kind of report.kinds) assert.ok(visible.includes(kind),`${scene}: model ${kind} was not submitted`);
    await page.screenshot({path:new URL(`roster-${scene}.png`,output).pathname,timeout:30000});
    console.log(JSON.stringify(report));
  }
  await page.evaluate(()=>window.fleetRenderer.dispose());
  assert.deepEqual(errors,[]);
  await writeFile(new URL('fleet-runtime-report.json',output),JSON.stringify({loaded,errors},null,2));
} finally {await browser.close();}
