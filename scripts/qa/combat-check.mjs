/**
 * Foreground visual QA for the combat / HUD pass. Reuses launchCheckPage()
 * (headed real Chrome + WebGPU on win32), drives Continue -> in-game -> select
 * a friendly army -> aim an attack, and screenshots each stage into artifacts/.
 *
 *   node scripts/qa/combat-check.mjs [url]
 *
 * Standalone on purpose: visual-check.mjs carries hard world-validation
 * assertions that would fail this run for unrelated reasons.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchCheckPage } from './browser.mjs';

const out = fileURLToPath(new URL('../../artifacts/', import.meta.url));
await mkdir(out, { recursive: true });
const shot = (name) => ({ path: path.join(out, name) });

const { browser, page, errors } = await launchCheckPage();
const log = (...a) => console.log('[combat-check]', ...a);
const BASE = process.argv[2] ?? 'http://127.0.0.1:5173/';

try {
  // ONE fixed, reused QA account with ONE permanent seat. The first ever run
  // registers it and joins a single country; every later run logs in and hits
  // Continue. This deliberately avoids grabbing a fresh curated nation per run
  // (four earlier runs each burned one, which had to be reverted). The single
  // qa-combat seat is acknowledged permanent QA debris in the live game.json.
  const QA_USER = 'qa-combat';
  const QA_PASS = 'qa-combat-pw-9137';
  const authHeaders = { 'content-type': 'application/json', origin: 'http://127.0.0.1:5173' };
  await fetch('http://127.0.0.1:3001/v1/auth/register', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ username: QA_USER, password: QA_PASS }),
  }).catch(() => {}); // already exists after the first run — fine
  const auth = await fetch('http://127.0.0.1:3001/v1/auth/login', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ username: QA_USER, password: QA_PASS }),
  });
  const cookie = (auth.headers.get('set-cookie') || '').split(';')[0];
  const [name, value] = cookie.split('=');
  await page.context().addCookies([
    { name, value, domain: '127.0.0.1', path: '/', httpOnly: true, sameSite: 'Lax' },
  ]);
  log('authed as fixed QA account; cookie set');

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2_000);
  await page.screenshot(shot('cc-00-menu.png'));

  // If this QA account already holds its seat, Continue is enabled -> resume it.
  // Otherwise (first run only) drive New Campaign once to create the single seat.
  const hasSeat = await page.evaluate(() => {
    const c = document.getElementById('ifm-continue');
    return !!c && !c.disabled && !c.classList.contains('is-disabled');
  });
  if (hasSeat) {
    log('QA account already seated -> Continue');
    await page.evaluate(() => document.getElementById('ifm-continue')?.click());
  } else {
    log('first run -> New Campaign (creates the one permanent QA seat)');
    await page.evaluate(() => document.getElementById('ifm-new-campaign')?.click());
    await page.waitForTimeout(1_200);
    await page.evaluate(() => document.getElementById('ifm-begin-operation')?.click());
    await page.waitForTimeout(900);
    await page.screenshot(shot('cc-00b-nation-picker.png'));
    await page.evaluate(() => {
      document.querySelector('#ifm-country-grid .ifm__country:not(.is-unavailable)')?.click();
    });
    await page.waitForTimeout(400);
    await page.evaluate(() => document.getElementById('ifm-confirm-nation')?.click());
  }

  await page.waitForFunction(
    () => !!window.__ironfrontsSession && document.getElementById('loading')?.hasAttribute('hidden'),
    null, { timeout: 60_000 },
  );
  await page.waitForTimeout(1_500);
  await page.screenshot(shot('cc-01-ingame.png'));

  const overview = await page.evaluate(() => {
    const s = window.__ironfrontsSession;
    const armies = Object.values(s.state.armies);
    return {
      tick: s.state.simulationTick,
      total: armies.length,
      own: armies.filter((a) => a.own).length,
      visibleEnemies: armies.filter((a) => !a.own && a.contact === 'visible').length,
      contactEnemies: armies.filter((a) => !a.own && a.contact === 'contact').length,
      nowPlaying: document.getElementById('now-playing-title')?.textContent ?? null,
      nowPlayingShown: !document.getElementById('now-playing')?.hidden,
    };
  });
  log('overview', JSON.stringify(overview));

  // Focus a friendly army, then screen-project it and click it to select.
  const picked = await page.evaluate(() => {
    const s = window.__ironfrontsSession;
    const r = window.__ironfrontsRenderer;
    const mine = Object.values(s.state.armies).find((a) => a.own && a.status !== 'engaged');
    if (!mine) return null;
    r.focus(mine.x, mine.z, 700);
    return { id: mine.id, x: mine.x, z: mine.z };
  });
  log('friendly army', JSON.stringify(picked));
  await page.waitForTimeout(1_200);
  await page.screenshot(shot('cc-02-focus-friendly.png'));

  // Click the friendly army at screen-centre (renderer.focus centres it).
  const vp = page.viewportSize();
  await page.mouse.click(vp.width / 2, vp.height / 2);
  await page.waitForTimeout(700);
  const panel = await page.evaluate(() => {
    const el = document.querySelector('.ifg-army-panel');
    return { armyPanelShown: el ? !el.hidden : false, cursor: document.getElementById('world')?.style.cursor ?? '' };
  });
  log('after friendly click', JSON.stringify(panel));
  await page.screenshot(shot('cc-03-army-selected.png'));

  // Enter attack targeting (A), move the cursor over a visible enemy, screenshot the cursor.
  const enemy = await page.evaluate(() => {
    const s = window.__ironfrontsSession;
    const vis = Object.values(s.state.armies).find((a) => !a.own && a.contact === 'visible');
    const con = Object.values(s.state.armies).find((a) => !a.own && a.contact === 'contact');
    return {
      visible: vis ? { x: vis.x, z: vis.z } : null,
      contact: con ? { x: con.x, z: con.z } : null,
      selected: window.__ironfrontsRenderer ? true : false,
    };
  });
  log('enemy targets', JSON.stringify(enemy));

  if (enemy.visible) {
    // Re-select the friendly army (a prior click may have picked the enemy),
    // arm attack targeting with the new 'a' hotkey, frame the enemy, screenshot
    // the cursor, then click to issue — capturing the reticle + toast.
    await page.evaluate((id) => {
      const r = window.__ironfrontsRenderer;
      const a = window.__ironfrontsSession.state.armies[id];
      r.focus(a.x, a.z, 650);
    }, picked.id);
    await page.waitForTimeout(700);
    await page.mouse.click(vp.width / 2, vp.height / 2); // select friendly
    await page.waitForTimeout(300);
    await page.keyboard.press('a'); // arm attack targeting
    await page.waitForTimeout(200);
    await page.evaluate(({ x, z }) => window.__ironfrontsRenderer.focus(x, z, 650), enemy.visible);
    await page.waitForTimeout(900);
    await page.mouse.move(vp.width / 2, vp.height / 2);
    await page.waitForTimeout(200);
    const cur = await page.evaluate(() => document.getElementById('world')?.style.cursor ?? '');
    log('cursor over VISIBLE enemy:', cur);
    await page.screenshot(shot('cc-04-attack-cursor-visible.png'));

    // Immediately after the click: the optimistic ack (toast + reticle) is what
    // this pass added and can verify. The 90ms sample catches the optimistic
    // mutation before any server round-trip.
    await page.mouse.click(vp.width / 2, vp.height / 2);
    await page.waitForTimeout(90);
    const ack = await page.evaluate((id) => {
      const a = window.__ironfrontsSession.state.armies[id];
      return {
        status: a?.status, moveIntent: a?.moveIntent,
        reticle: !!document.querySelector('.ifg-attack-flash.is-firing'),
        toasts: [...document.querySelectorAll('.ifg-notify__item')].map((n) => n.textContent?.trim()),
      };
    }, picked.id);
    log('optimistic ack (t+90ms):', JSON.stringify(ack));
    await page.screenshot(shot('cc-05-attack-issued.png'));
    // Attacking a country you are not yet at war with round-trips a "Declare
    // war?" modal; the optimistic order is reverted until it is confirmed. Click
    // through it so the end-to-end path can actually be measured.
    await page.waitForTimeout(500);
    const warPrompt = await page.evaluate(() => {
      const dlg = document.querySelector('dialog.ifg-command-dialog');
      if (!dlg) return null;
      const title = dlg.querySelector('h2')?.textContent ?? '';
      dlg.querySelector('button.is-primary')?.click();
      return title;
    });
    if (warPrompt) log('war-confirmation modal shown & confirmed:', JSON.stringify(warPrompt));
    // ~1.2s later: did the SERVER accept the order (army moving with a move
    // order) or reject it. Reported separately from the optimistic ack.
    await page.waitForTimeout(1_100);
    const post = await page.evaluate((id) => {
      const a = window.__ironfrontsSession.state.armies[id];
      return {
        status: a?.status, moveIntent: a?.moveIntent,
        hasMoveOrder: !!a?.moveOrder,
        moveOrderTarget: a?.moveOrder?.attackTargetId ?? a?.moveOrder?.targetProvinceId ?? null,
        pathLen: a?.moveOrder?.path?.length ?? 0,
        toasts: [...document.querySelectorAll('.ifg-notify__item')].map((n) => n.textContent?.trim()),
      };
    }, picked.id);
    log('server outcome (t+1.2s):', JSON.stringify(post));
    if (post.status === 'moving' && post.hasMoveOrder) log('OK: server accepted the attack order end-to-end');
    else if (warPrompt) log('NOTE: order still not moving after confirming war (may need another sim tick)');
    else log('NOTE: server did not confirm an attack order (no war prompt seen either)');
    await page.screenshot(shot('cc-06-after-attack.png'));
  }
  if (enemy.contact) {
    await page.evaluate((id) => {
      const r = window.__ironfrontsRenderer;
      const a = window.__ironfrontsSession.state.armies[id];
      r.focus(a.x, a.z, 650);
    }, picked.id);
    await page.waitForTimeout(700);
    await page.mouse.click(vp.width / 2, vp.height / 2);
    await page.waitForTimeout(300);
    await page.keyboard.press('a');
    await page.waitForTimeout(200);
    // Zoom in tight so the contact-only blip is the ONLY army near screen-centre,
    // then confirm the centre pick really is that contact army before judging
    // the cursor — otherwise a nearby *visible* enemy under the pixel makes the
    // attack cursor legitimate and the check meaningless.
    await page.evaluate(({ x, z }) => window.__ironfrontsRenderer.focus(x, z, 240), enemy.contact);
    await page.waitForTimeout(900);
    await page.mouse.move(vp.width / 2, vp.height / 2);
    await page.waitForTimeout(80);
    await page.mouse.move(vp.width / 2 + 1, vp.height / 2); // nudge to force a fresh pointermove -> updateWorldCursor
    await page.waitForTimeout(200);
    const probe = await page.evaluate(() => {
      const r = window.__ironfrontsRenderer;
      const s = window.__ironfrontsSession;
      const cx = Math.round(window.innerWidth / 2) + 1;
      const cy = Math.round(window.innerHeight / 2);
      const id = r.pickArmyAt(cx, cy);
      const a = id ? s.state.armies[id] : null;
      return {
        cursor: document.getElementById('world')?.style.cursor ?? '',
        pickedId: id,
        pickedContact: a ? a.contact : null,
        pickedOwn: a ? a.own : null,
      };
    });
    log('contact-only probe:', JSON.stringify(probe));
    if (probe.pickedContact !== 'contact') {
      log('SKIP: could not isolate a contact-only army under the cursor (picked', probe.pickedContact + ')');
    } else {
      // The pick under the cursor is definitively a contact-only enemy. The
      // attack cursor here would be a fog leak.
      const leak = probe.cursor.includes('action-attack');
      log(leak ? 'FAIL: attack cursor over a confirmed contact-only target (fog leak)'
        : 'OK: no attack affordance for a confirmed contact-only target (cursor: ' + (probe.cursor || 'default') + ')');
      if (leak) errors.push('fog: attack cursor shown for a confirmed contact-only target');
    }
    await page.screenshot(shot('cc-07-cursor-contact-only.png'));
  }

  // Building scale + coastline: park over the urban showcase, close in.
  await page.evaluate(async () => {
    const r = window.__ironfrontsRenderer;
    const m = await fetch('/world/world.json').then((x) => x.json());
    r.focus(m.showcases.urban[0], m.showcases.urban[1], 360);
  });
  await page.waitForTimeout(1_100);
  await page.screenshot(shot('cc-08-buildings-close.png'));

  log('console errors:', errors.length ? errors.join(' | ') : 'none');
} catch (err) {
  console.error('[combat-check] FAILED:', err.message);
  await page.screenshot(shot('cc-99-failure.png')).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
