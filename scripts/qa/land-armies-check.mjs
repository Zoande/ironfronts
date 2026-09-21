/** Isolated renderer fixture: does not connect to accounts or mutate a campaign. */
import { chromium } from 'playwright-core';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const output = new URL('../../artifacts/land-armies/',import.meta.url);
await mkdir(output,{recursive:true});
const browser = await chromium.launch({
  executablePath: process.env.IRONFRONTS_BROWSER ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true, args: ['--enable-unsafe-webgpu'],
});
const page = await browser.newPage({ viewport:{width:1600,height:1000}, deviceScaleFactor:1 });
const errors=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(message.type()==='error'||(message.type()==='warning'&&!message.text().includes('powerPreference'))) { if(!errors.includes(message.text()))errors.push(message.text()); }});
await page.route('**/__landqa',route=>route.fulfill({contentType:'text/html',body:
  '<html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}canvas{width:100%;height:100%;display:block}</style><canvas id="world"></canvas></html>'}));
try {
  await page.goto(base+'/__landqa');
  await page.evaluate(async()=>{
    const {WorldRenderer}=await import('/src/rendering/renderer.ts');
    const renderer=new WorldRenderer(document.querySelector('canvas'),undefined,'high');
    await renderer.initialize(()=>{});
    window.landRenderer=renderer;
    renderer.setTimeOfDay(13);renderer.setTimeMultiplier(0);
    renderer.setCountryOverlayVisible(false);
    window.landCenter=[renderer.manifest.showcases.dirtRoad[0]+65,renderer.manifest.showcases.dirtRoad[1]+25];
    renderer.setPerformanceLayerVisibility({trees:false,buildings:false});
    const [x,z]=window.landCenter;
    const models=new Float32Array(8*16);
    for(let side=0;side<2;side++)for(let kind=0;kind<4;kind++){
      const i=side*4+kind;const o=i*16;
      models.set([x+(kind-1.5)*11,z+(side?16:-16),side?0xb69a65:0x547b80,kind,
        1,1,8,side?0:Math.PI,0,kind*.19+side*.071,0,side?0:Math.PI,
        x+(kind-1.5)*11,z+(side?16:-16),0,0],o);
    }
    window.landModels=models;
    renderer.setArmyMarkers(new Float32Array(28),0,[],models,8);
    const {CombatEffectPool}=await import('/src/rendering/combat-effects.ts');
    const {nextLandShot,landMuzzlePosition}=await import('/src/rendering/land-animation.ts');
    const pool=new CombatEffectPool(384);const scheduled=new Map();
    window.landPool=pool;
    window.landFxTimer=setInterval(()=>{
      for(let i=0;i<8;i++){
        const o=i*16,kind=models[o+3],phase=models[o+9];
        const shot=nextLandShot(renderer.unitAnimationTime,phase,kind);
        if(shot.at-renderer.unitAnimationTime>.16||scheduled.get(i)===shot.cycle)continue;
        scheduled.set(i,shot.cycle);
        const socket=renderer.landWeaponSocket(kind);if(!socket)continue;
        const muzzle=landMuzzlePosition(models[o],models[o+1],models[o+7],socket.point,socket.scale);
        const enemy=(i<4?i+4:i-4)*16;
        pool.spawnWeaponShot(kind,muzzle.x,muzzle.z,models[enemy],models[enemy+1],{
          height:muzzle.height,now:Date.now()+(shot.at-renderer.unitAnimationTime)*1000,
        });
      }
    },100);
    renderer.onFrame=()=>{
      const packed=pool.collect(Date.now(),{x,z},5000);
      window.landFxPeak=Math.max(window.landFxPeak??0,packed.count);
      renderer.setCombatEffects(packed.floats,packed.count);
    };
    renderer.focus(x,z,100,-.55,.85);renderer.start();
  });
  await page.waitForTimeout(2500);
  await page.evaluate(()=>window.landRenderer.resetPerformanceSamples());
  await page.waitForTimeout(1500);
  await page.screenshot({path:fileURLToPath(new URL('in-game-close.png',output))});
  const report=await page.evaluate(()=>({
    loaded:window.landRenderer.landUnits.map(unit=>({family:unit.family,loaded:!!unit.model,
      triangles:unit.model?.lods.map(lod=>lod.indexCount/3),socket:unit.model?.fireMuzzle})),
    performance:window.landRenderer.getPerformanceSnapshot(),
    effectsPeak:window.landFxPeak??0,
  }));
  await page.evaluate(()=>{
    const r=window.landRenderer,m=window.landModels;
    const socket=r.landWeaponSocket(2);
    const at=Date.now();
    window.landPool.spawnWeaponShot(2,m[32],m[33]-socket.point[2]*socket.scale,m[96]+7,m[97],{height:socket.point[1]*socket.scale,now:at});
    r.onFrame=()=>{const packed=window.landPool.collect(at+430,{x:m[32],z:m[33]},5000);r.setCombatEffects(packed.floats,packed.count);};
  });
  await page.waitForTimeout(430);
  await page.screenshot({path:fileURLToPath(new URL('in-game-impact.png',output))});
  await page.evaluate(()=>{
    clearInterval(window.landFxTimer);window.landPool.clear();
    window.landRenderer.onFrame=undefined;window.landRenderer.setCombatEffects(new Float32Array(0),0);
    const r=window.landRenderer,m=window.landModels.slice();
    for(let i=0;i<8;i++) {const o=i*16;m[o+6]=2;m[o+7]=Math.PI/2;m[o+11]=Math.PI/2;m[o+12]=m[o]+20;m[o+14]=4;}
    r.setArmyMarkers(new Float32Array(28),0,[],m,8);
  });
  await page.waitForTimeout(1000);
  await page.screenshot({path:fileURLToPath(new URL('in-game-movement.png',output))});
  await page.evaluate(()=>{
    const r=window.landRenderer;
    r.showArmyDestruction(window.landModels.slice(0,16));
    r.setArmyMarkers(new Float32Array(28),0,[],window.landModels.slice(16),7);
  });
  await page.waitForTimeout(1200);
  await page.screenshot({path:fileURLToPath(new URL('in-game-loss.png',output))});
  for(const distance of [350,1000]){
    await page.evaluate(distance=>window.landRenderer.focus(...window.landCenter,distance,-.55,.85),distance);
    await page.waitForTimeout(800);
    await page.screenshot({path:fileURLToPath(new URL(`in-game-${distance}.png`,output))});
  }
  await page.evaluate(()=>{
    const r=window.landRenderer,[x,z]=window.landCenter;
    const m=new Float32Array(400*16);
    for(let i=0;i<400;i++){
      const px=x+(i%20-9.5)*8,pz=z+(Math.floor(i/20)-9.5)*8;
      m.set([px,pz,0x778465,i%4,1,1,8,0,0,i/401,0,0,px,pz,0,0],i*16);
    }
    r.setArmyMarkers(new Float32Array(28),0,[],m,400);
    r.focus(x,z,350,-.55,.85);r.resetPerformanceSamples();
  });
  await page.waitForTimeout(2500);
  report.crowded=await page.evaluate(()=>window.landRenderer.getPerformanceSnapshot());
  await page.screenshot({path:fileURLToPath(new URL('in-game-crowded.png',output))});
  await page.evaluate(()=>window.landRenderer.dispose());
  await writeFile(new URL('runtime-report.json',output),JSON.stringify({...report,errors},null,2));
  console.log(JSON.stringify({loaded:report.loaded,errors},null,2));
  if(errors.length||!report.effectsPeak||report.loaded.some(unit=>!unit.loaded))process.exitCode=1;
} finally {await browser.close();}
