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
    window.firedFamilies=new Set();
    window.landPool=pool;
    window.landFxTimer=setInterval(()=>{
      for(let i=0;i<8;i++){
        const o=i*16,kind=models[o+3],phase=models[o+9];
        const shot=nextLandShot(renderer.unitAnimationTime,phase,kind);
        if(shot.at-renderer.unitAnimationTime>.16||scheduled.get(i)===shot.cycle)continue;
        scheduled.set(i,shot.cycle);
        window.firedFamilies.add(kind);
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
  await page.waitForFunction(()=>window.firedFamilies.size===4,{},{timeout:30000});
  await page.evaluate(()=>window.landRenderer.resetPerformanceSamples());
  await page.waitForTimeout(1500);
  await page.screenshot({path:fileURLToPath(new URL('in-game-close.png',output))});
  const report=await page.evaluate(()=>({
    loaded:window.landRenderer.landUnits.map(unit=>({family:unit.family,loaded:!!unit.model,
      triangles:unit.model?.lods.map(lod=>lod.indexCount/3),socket:unit.model?.fireMuzzle})),
    performance:window.landRenderer.getPerformanceSnapshot(),
    effectsPeak:window.landFxPeak??0,
    firedFamilies:[...window.firedFamilies],
    adapter: {vendor:window.landRenderer.adapter.info.vendor,architecture:window.landRenderer.adapter.info.architecture,
      device:window.landRenderer.adapter.info.device,description:window.landRenderer.adapter.info.description},
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
  await page.evaluate(()=>{
    const r=window.landRenderer,m=window.landModels.slice(0,16);
    r.landGhosts=[];
    const ground=r.sampleHeight(m[0],m[1]);
    m[6]=8;m[7]=Math.PI;m[11]=Math.PI;
    r.camera.minDistance=10;r.camera.minimumAltitude=ground+12;r.camera.target[1]=ground+1.7;
    r.setArmyMarkers(new Float32Array(28),0,[],m,1);
    r.focus(m[0],m[1],16,-.55,1.15);
  });
  await page.waitForTimeout(800);
  await page.screenshot({path:fileURLToPath(new URL('in-game-infantry.png',output))});
  report.transport=await page.evaluate(()=>{
    const r=window.landRenderer,[cx,cz]=window.landCenter;
    r.camera.target[1]=0;r.camera.minimumAltitude=80;r.camera.minDistance=90;
    let sea;
    for(let radius=60;radius<=900&&!sea;radius+=40)for(let i=0;i<24&&!sea;i++){
      const x=cx+Math.cos(i*Math.PI/12)*radius,z=cz+Math.sin(i*Math.PI/12)*radius;
      if([[0,0],[30,0],[-30,0],[0,30],[0,-30]].every(([dx,dz])=>r.sampleHeight(x+dx,z+dz)<.02&&r.sampleProvince(x+dx,z+dz)===0))sea=[x,z];
    }
    if(!sea)throw new Error('No open water found for transport inspection');
    const [x,z]=sea;
    const m=new Float32Array([x,z,0x547b80,5,1,1,2,0,0,.27,0,0,x,z-35,12,0]);
    r.setArmyMarkers(new Float32Array(28),0,[],m,1);r.focus(x,z,55,-.8,.85);
    window.transportFixture=m;
    return {position:sea,loaded:!!r.landUnits.find(unit=>unit.family==='transport')?.model};
  });
  await page.waitForTimeout(1600);
  await page.screenshot({path:fileURLToPath(new URL('in-game-transport.png',output))});
  await page.evaluate(()=>{
    const r=window.landRenderer,m=window.transportFixture;m[6]=0;m[14]=0;
    r.setArmyMarkers(new Float32Array(28),0,[],m,1);
  });
  await page.waitForTimeout(700);
  await page.screenshot({path:fileURLToPath(new URL('in-game-transport-idle.png',output))});
  await page.evaluate(()=>{
    const r=window.landRenderer,m=new Float32Array(9*16);
    m.set(window.landModels);m.set(window.transportFixture,8*16);
    for(let i=0;i<9;i++)m[i*16+6]=0;
    r.landGhosts=[];r.setPerformanceLayerVisibility({trees:true,buildings:true});
    r.setArmyMarkers(new Float32Array(28),0,[],m,9);
    const [x,z]=window.landCenter,ship=window.transportFixture;
    r.focus((x+ship[0])/2,(z+ship[1])/2,300,-.2,.95);
  });
  await page.waitForTimeout(1200);
  report.combinedVisible=await page.evaluate(()=>window.landRenderer.landUnits.map(unit=>({family:unit.family,count:unit.layer.count})));
  await page.screenshot({path:fileURLToPath(new URL('in-game-combined.png',output))});
  await page.evaluate(()=>window.landRenderer.dispose());
  await writeFile(new URL('runtime-report.json',output),JSON.stringify({...report,errors},null,2));
  const views=[
    ['Infantry: firing pose','infantry-fire.png'],['Original transport','transport.png'],
    ['Mixed land armies','in-game-close.png'],['Shell impact','in-game-impact.png'],
    ['Movement','in-game-movement.png'],['Loss animation','in-game-loss.png'],
    ['400-model scene','in-game-crowded.png'],['Transport underway','in-game-transport.png'],
    ['Transport stopped','in-game-transport-idle.png'],['Infantry detail inspection','in-game-infantry.png'],
    ['All five families in the game world','in-game-combined.png'],
  ];
  await writeFile(new URL('review.html',output),`<!doctype html><html lang="en"><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1"><title>Ironfronts unit visual review</title>
    <style>body{margin:0;padding:32px;background:#151b20;color:#eee;font:16px system-ui}main{max-width:1500px;margin:auto}
    h1{font-size:30px}p{color:#b9c5cc;line-height:1.6}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:24px}
    figure{margin:0;background:#222b32;border-radius:8px;overflow:hidden}img{display:block;width:100%;height:auto}figcaption{padding:14px}a{color:#b7d7ed}</style>
    <main><h1>Army and transport visual review</h1><p>Original Blender assets and captures from the game renderer.
    All four land types fired during this check; ${errors.length} browser/GPU errors. The scene uses the high graphics preset at 1600 × 1000;
    trees and buildings are hidden for unit inspection and enabled in the combined view. The infantry detail view uses a closer inspection camera than gameplay.</p>
    <p>Frame median: ${report.performance.frame.median.toFixed(1)} ms. 400-model median: ${report.crowded.frame.median.toFixed(1)} ms.
    These local timings are not a guarantee for other devices. <a href="runtime-report.json">Full runtime report</a>.</p>
    <section>${views.map(([title,file])=>`<figure><a href="${file}"><img loading="lazy" src="${file}" alt="${title}"></a><figcaption>${title}</figcaption></figure>`).join('')}</section></main></html>`);
  console.log(JSON.stringify({loaded:report.loaded,errors},null,2));
  if(errors.length||report.firedFamilies.length!==4||!report.effectsPeak||!report.transport.loaded
    ||report.loaded.some(unit=>!unit.loaded)||report.combinedVisible.some(unit=>!unit.count))process.exitCode=1;
} finally {await browser.close();}
