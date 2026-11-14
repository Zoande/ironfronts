/** Run against client:dev. Exercises real HUD DOM without needing a GPU or an account. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const origin = process.argv[2] ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({
  executablePath: process.env.IRONFRONTS_BROWSER ?? (process.platform === 'win32' ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' : '/usr/bin/chromium'),
  headless: true, args: process.env.IRONFRONTS_NO_SANDBOX === 'true' ? ['--no-sandbox'] : [],
});
try {
  const page = await browser.newPage();
  await page.route(`${origin}/__command-ui-check`, route => route.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>'}));
  await page.goto(`${origin}/__command-ui-check`);
  await page.evaluate(async () => {
    await import('/src/styles.css');
    await import('/node_modules/@fontsource/bitter/latin-ext-800.css');
    await import('/node_modules/@fontsource/special-elite/latin-ext-400.css');
    const { createInitialState, createUiStore } = await import('/src/ui/state/store.ts');
    const { mountGameUi } = await import('/src/ui/shell/game-ui.ts');
    const { DEMO_ARMY } = await import('/src/ui/army.ts');
    const state = createInitialState({phase:'in-game',playerCountry:{name:'United Kingdom',color:'#375fa3'},
      resources:['money','manpower','food','stone','metal','oil'].map(id=>({id,label:id,value:123456,delta:-15.5})),
      selectedArmy:{...DEMO_ARMY,attack:{soft:342,light:12500,heavy:69,ship:45,submarine:9},activity:'Moving · 12 orders queued'},
    });
    window.commandUiStore = createUiStore(state);
    mountGameUi(window.commandUiStore,new Proxy({}, {get:()=>()=>{}}));
    await document.fonts.ready;
  });
  for (const mode of ['idle','combat']) {
    if (mode === 'combat') await page.evaluate(() => {
      const store = window.commandUiStore, state = store.get();
      const modifiers = {frontageUsed:10,frontageLimit:10,coordination:1,organization:1,stanceOutput:1,supply:.75,protection:1,terrain:1,devastation:1};
      store.patch({resources:[...state.resources,{id:'warheads',label:'Warheads',value:12}],selectedArmy:{...state.selectedArmy,
        combat:'engaged',activity:'Engaged on two fronts',activityKind:'combat',
        battleFronts:[{id:'qa',directionNodeId:1,role:'attack',friendlyHp:600,friendlyBaselineHp:1200,enemyHp:500,enemyBaselineHp:1000,
          reinforcementCount:2,outgoingDamagePerGameHour:342,incomingDamagePerGameHour:160,friendlyCasualties:6,enemyCasualties:10,
          estimatedGameHours:2,estimatedRealSeconds:7200,friendlyModifiers:modifiers,enemyModifiers:modifiers}],
      }});
    });
  for (const width of [320,375,640,806,1024,1280]) {
    await page.setViewportSize({width,height:800});
    await page.waitForTimeout(250);
    const result = await page.evaluate(() => {
      const panel = document.querySelector('.ifg-army-panel');
      const resources = document.querySelector('.ifg-topbar__resources');
      const body = document.querySelector('.ifg-army-panel__body');
      const cells = [...document.querySelectorAll('.ifg-army-panel__stat-table tbody td')];
      const textFits = cells.every(cell => {
        const range = document.createRange();range.selectNodeContents(cell);
        return range.getBoundingClientRect().width <= cell.getBoundingClientRect().width - 2;
      });
      const bounds = panel.getBoundingClientRect();
      body.scrollTop = body.scrollHeight;
      return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,textFits,
        resourcesFit:resources.scrollWidth <= resources.clientWidth + 1,
        panelFits:bounds.left >= 0 && bounds.right <= innerWidth,
        bodyFits:body.scrollWidth <= body.clientWidth + 1,
        canReachBottom:body.scrollHeight <= body.clientHeight || body.scrollTop > 0,
        captionsVisible:getComputedStyle(document.querySelector('.ifg-army-panel__command-label')).display !== 'none',
        values:cells.map(cell=>cell.textContent),
      };
    });
    assert.ok(result.documentWidth <= width + 1, `Page overflow at ${width}px`);
    assert.ok(result.panelFits && result.bodyFits, `Army content clipped at ${width}px`);
    assert.ok(result.textFits, `Damage values collide at ${width}px`);
    assert.equal(result.captionsVisible,width <= 860, `Command captions at ${width}px`);
    assert.ok(result.canReachBottom, `Army details cannot be scrolled at ${width}px`);
    if(width <= 640) assert.ok(result.resourcesFit, `Resources hidden at ${width}px`);
    console.log(JSON.stringify({mode,...result}));
  }
  }
  await page.evaluate(() => {
    const store=window.commandUiStore;
    store.patch({selectedArmy:{...store.get().selectedArmy,combat:'idle',battleFronts:[],domain:'naval',transportLevel:undefined,
      groups:[{typeId:'submarine-l3',label:'Submarine Level 3',count:1,health:1,camouflageLevel:3,revealLevel:0}]}});
  });
  assert.match(await page.locator('.ifg-army-unit__details').textContent(),/Camo 3.*Reveal 0/);
  await page.evaluate(() => {
    const store=window.commandUiStore;
    store.patch({selectedArmy:{...store.get().selectedArmy,domain:'naval',transportLevel:4,
      groups:[{typeId:'medium-tank',label:'Medium Tank cargo',count:2,health:.8}]}});
  });
  assert.equal(await page.locator('[data-unit-type="transport"]').count(),1);
  assert.equal(await page.locator('[data-unit-type="medium-tank"]').count(),0);
  assert.match(await page.locator('.ifg-army-unit__details').textContent(),/Convoy Level 4.*Medium Tank cargo/);
  console.log('Camouflage/reveal levels and convoy portrait/cargo display verified.');
} finally { await browser.close(); }
