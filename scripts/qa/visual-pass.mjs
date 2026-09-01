/**
 * Foreground visual QA for pass 2d. Headed real Chrome + WebGPU (launchCheckPage),
 * one fixed qa-combat seat (Continue, never register), then:
 *   - spawns a full sampler of pooled combat effects + a battle marker and
 *     screenshots them at close / medium / far zoom (CombatEffectPool render path);
 *   - cycles the four graphics presets and screenshots each with the diagnostics
 *     readout visible, logging the resolved knobs so the differences are objective;
 *   - screenshots the army HUD and a command tooltip.
 *
 *   node scripts/qa/visual-pass.mjs [url]
 *
 * Writes artifacts/qa-*.png. Does not commit them.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchCheckPage } from './browser.mjs';

const out = fileURLToPath(new URL('../../artifacts/', import.meta.url));
await mkdir(out, { recursive: true });
const shot = (name) => ({ path: path.join(out, name) });

const { browser, page, errors } = await launchCheckPage();
const log = (...a) => console.log('[visual-pass]', ...a);
const BASE = (process.argv[2] ?? 'http://127.0.0.1:5173/').replace(/\/?$/, '/');

try {
  const QA_USER = 'qa-combat';
  const QA_PASS = 'qa-combat-pw-9137';
  const authHeaders = { 'content-type': 'application/json', origin: 'http://127.0.0.1:5173' };
  await fetch('http://127.0.0.1:3001/v1/auth/register', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ username: QA_USER, password: QA_PASS }),
  }).catch(() => {});
  const auth = await fetch('http://127.0.0.1:3001/v1/auth/login', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ username: QA_USER, password: QA_PASS }),
  });
  const cookie = (auth.headers.get('set-cookie') || '').split(';')[0];
  const [name, value] = cookie.split('=');
  await page.context().addCookies([
    { name, value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  log('authed as fixed QA account');

  await page.goto(`${BASE}?debug=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2_000);
  const hasSeat = await page.evaluate(() => {
    const c = document.getElementById('ifm-continue');
    return !!c && !c.disabled && !c.classList.contains('is-disabled');
  });
  if (!hasSeat) {
    log('no qa-combat seat yet — run combat-check.mjs once first; aborting');
    process.exitCode = 1;
  } else {
    await page.evaluate(() => document.getElementById('ifm-continue')?.click());
    await page.waitForFunction(
      () => !!window.__ironfrontsSession && document.getElementById('loading')?.hasAttribute('hidden'),
      null, { timeout: 60_000 },
    );
    await page.waitForTimeout(1_500);

    // ---- combat effects sampler --------------------------------------------
    const spot = await page.evaluate(() => {
      const s = window.__ironfrontsSession;
      const r = window.__ironfrontsRenderer;
      const mine = Object.values(s.state.armies).find((a) => a.own) ?? Object.values(s.state.armies)[0];
      r.focus(mine.x, mine.z, 520);
      return { x: mine.x, z: mine.z };
    });
    const spawnSampler = (sx, sz) => page.evaluate(({ x, z }) => {
      const pool = window.__ironfrontsCombatEffects;
      const K = {
        muzzleFlash: 0, tracer: 1, projectile: 2, impact: 3, dust: 4,
        smoke: 5, explosion: 6, targetFlash: 7,
      };
      pool.setBattle('qa-a', x, z, 1, Math.PI / 4);
      pool.setBattle('qa-b', x + 140, z - 90, 1, -Math.PI / 3);
      let i = 0;
      for (const k of Object.keys(K)) {
        const px = x + Math.cos(i) * 60;
        const pz = z + Math.sin(i) * 60;
        pool.spawn(K[k], px, pz, { scale: 1.2, dir: i, lifetimeMs: 6_000 });
        i += 0.8;
      }
      pool.spawnVolley('artillery', x - 60, z + 40, 0.4);
      pool.spawnVolley('armor', x + 40, z + 70, 2.1);
      pool.spawnVolley('infantry', x - 90, z - 40, 1.2);
      return pool.liveTransients(Date.now());
    }, { x: sx, z: sz });

    for (const [zoom, tag] of [[300, 'close'], [900, 'medium'], [3200, 'far']]) {
      await page.evaluate(({ x, z, d }) => window.__ironfrontsRenderer.focus(x, z, d), { x: spot.x, z: spot.z, d: zoom });
      await page.waitForTimeout(500);
      const live = await spawnSampler(spot.x, spot.z);
      await page.waitForTimeout(350);
      await page.screenshot(shot(`qa-combat-${tag}.png`));
      log(`combat ${tag}: ${live} live transients spawned`);
    }

    // ---- graphics presets -------------------------------------------------
    // Diagnostics panel visible (?debug=1). Park the camera on the urban
    // showcase so props / buildings / render scale differences are in frame.
    await page.evaluate(async () => {
      const r = window.__ironfrontsRenderer;
      const m = await fetch('/world/world.json').then((x) => x.json());
      if (m.showcases?.urban) r.focus(m.showcases.urban[0], m.showcases.urban[1], 900);
      const d = document.getElementById('diagnostics');
      if (d && d.hidden) document.getElementById('debug-toggle')?.click();
    });
    await page.waitForTimeout(600);
    for (const level of ['low', 'medium', 'high', 'ultra']) {
      const readout = await page.evaluate((lvl) => {
        window.__ironfrontsRenderer.setQuality(lvl);
        const r = window.__ironfrontsRenderer;
        const c = document.getElementById('world');
        return { level: r.graphicsQuality, scale: r.effectiveRenderScale,
          canvas: `${c.width}x${c.height}`, knobs: r.qualityReadout };
      }, level);
      await page.waitForTimeout(900);
      await page.screenshot(shot(`qa-quality-${level}.png`));
      log(`quality ${level}:`, JSON.stringify(readout));
    }

    // ---- army HUD + tooltip --------------------------------------------
    await page.evaluate(() => window.__ironfrontsRenderer.setQuality('high'));
    const own = await page.evaluate(() => {
      const s = window.__ironfrontsSession;
      const a = Object.values(s.state.armies).find((x) => x.own);
      if (a) window.__ironfrontsRenderer.focus(a.x, a.z, 620);
      return !!a;
    });
    if (own) {
      await page.waitForTimeout(800);
      const vp = page.viewportSize();
      await page.mouse.click(vp.width / 2, vp.height / 2);
      await page.waitForTimeout(600);
      await page.screenshot(shot('qa-ui-army.png'));
      const cmd = await page.$('.ifg-army-panel__command');
      if (cmd) {
        await cmd.hover();
        await page.waitForTimeout(400);
        const tip = await page.evaluate(() => {
          const t = document.querySelector('.ifg-tip');
          return t ? t.textContent?.replace(/\s+/g, ' ').trim() : null;
        });
        log('command tooltip:', JSON.stringify(tip));
        await page.screenshot(shot('qa-ui-tooltip-command.png'));
      }
    }
    log('console errors:', errors.length ? errors.join(' | ') : 'none');
  }
} catch (err) {
  console.error('[visual-pass] FAILED:', err.message);
  await page.screenshot(shot('qa-99-failure.png')).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
