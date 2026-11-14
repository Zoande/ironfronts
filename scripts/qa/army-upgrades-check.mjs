/** Real DOM check for the upgrade quote at phone and desktop widths. Run against client:dev. */
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const origin = process.argv[2] ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: process.env.IRONFRONTS_BROWSER ?? '/usr/bin/chromium', headless: true,
  args: process.env.IRONFRONTS_NO_SANDBOX === 'true' ? ['--no-sandbox'] : [] });
try {
  const page = await browser.newPage();
  await page.route(`${origin}/__upgrade-check`, route => route.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body></body>'}));
  for (const width of [320, 1280]) {
    await page.setViewportSize({width,height:800});
    await page.goto(`${origin}/__upgrade-check`);
    await page.evaluate(async () => {
      await import('/src/styles.css');
      const { confirmArmyUpgrade } = await import('/src/ui/army-upgrade-dialog.ts');
      window.upgradeAccepted = null;
      void confirmArmyUpgrade({key:'qa',entries:[{typeId:'infantry',targetTypeId:'infantry-l3',count:3},{typeId:'medium-tank',targetTypeId:'medium-tank-l2',count:1}],cost:{funds:1250,metal:230},totalHours:4,canStart:true},id=>id).then(accepted=>{window.upgradeAccepted=accepted;});
    });
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.locator('.ifg-upgrade-dialog__troops li').count(),2);
    assert.equal(await page.locator('.ifg-upgrade-dialog__troops [role="img"]').count(),2);
    assert.match(await page.locator('.ifg-upgrade-dialog__total').textContent(),/1250 funds.*230 metal/);
    assert.match(await page.getByRole('dialog').textContent(),/4.0 game hours/);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.getByRole('button',{name:'Begin upgrade'}).click();
    assert.equal(await page.evaluate(()=>window.upgradeAccepted),true);
    console.log(`Upgrade quote reviewed and confirmed at ${width}px.`);
  }
} finally { await browser.close(); }
