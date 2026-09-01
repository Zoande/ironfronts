import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const main = readFileSync(path.join(root, 'src/main.ts'), 'utf8');
const notifications = readFileSync(path.join(root, 'src/ui/notifications.ts'), 'utf8');

describe('attack-order feedback', () => {
  it('shows the attack cursor only for a fully identified enemy, never a contact-only blip', () => {
    const fn = main.slice(main.indexOf('const updateWorldCursor ='), main.indexOf('canvas.addEventListener(\'pointermove\''));
    // The strikable test is gated on visible contact, matching the server's
    // "a direct strike needs an identified target" rule.
    expect(fn).toMatch(/hovered\.contact === 'visible'/);
    expect(fn).toContain('action-attack.png');
    expect(fn).toContain('cursor-no.png');
  });

  it('drives distinct world cursors for rally placement and ground-order aiming', () => {
    const fn = main.slice(main.indexOf('const updateWorldCursor ='), main.indexOf('canvas.addEventListener(\'pointermove\''));
    expect(fn).toContain('cursors/cursor-rally.png');
    expect(fn).toMatch(/awaitingRallyTarget && selectedProvinceId !== null/);
    // move / split / retreat aiming get a precision cursor, not the default arrow
    expect(fn).toMatch(/targetingMode === 'move' \|\| targetingMode === 'split' \|\| targetingMode === 'retreat'/);
  });

  it('acknowledges an attack on server-accept (after any war confirm), not optimistically', () => {
    const start = main.indexOf("targetingMode === 'attack' && selectedArmyId");
    const branch = main.slice(start, main.indexOf("targetingMode === 'retreat'", start));
    // The reticle / cue / toast live in one closure...
    expect(branch).toContain('const acknowledgeAttack = ()');
    expect(branch).toContain('flashAttackTarget(clientX, clientY)');
    expect(branch).toMatch(/pushNotification\('information', 'Attack order issued'/);
    expect(branch).toContain("audio.playUiCue('confirm')");
    // ...that is handed to the order as its onAccepted callback, never called
    // from the synchronous (optimistic) path.
    expect(branch).toContain('session.orderAttackArmy(selectedArmyId, targetArmyId, acknowledgeAttack)');
    expect(branch).toContain('session.orderAttackProvince(selectedArmyId!, provinceId, acknowledgeAttack)');
    expect(branch).not.toMatch(/}\s*else\s*{\s*\n\s*flashAttackTarget/);
  });

  it('threads onAccepted through the war-confirmation re-send', () => {
    const remote = readFileSync(path.join(root, 'src/client/remote-session.ts'), 'utf8');
    expect(remote).toContain('onAccepted?: () => void');
    expect(remote).toContain('onAccepted?.();');
    // re-send after respond(true) keeps the same callback
    expect(remote).toContain('this.send(confirmedCommand, mutation, onAccepted);');
  });

  it('rate-limits the under-attack alert so simultaneous battles cannot stack it', () => {
    const fn = main.slice(main.indexOf('function maybePlayCombatAlert'), main.indexOf('function drainSessionEvents'));
    expect(fn).toMatch(/now - lastCombatAlertAt < 3_000/);
    expect(fn).toContain('audio.playCombatAlert()');
  });

  it('locates an "under attack" toast on a friendly engaged stack for click-to-focus', () => {
    const block = main.slice(main.indexOf("// Locate the fight on one of the player's engaged stacks"));
    expect(block.slice(0, 700)).toMatch(/a\.own && a\.status === 'engaged'/);
    expect(block.slice(0, 700)).toMatch(/focus: \{ x: spot\.x, z: spot\.z \}/);
    expect(block.slice(0, 700)).toContain('maybePlayCombatAlert()');
  });

  it('spawns pooled world-space effects from the same combat events (LOD-gated)', () => {
    const block = main.slice(main.indexOf('const fxDensity = effectDensityForDistance'),
      main.indexOf('for (const cap of session.pendingCaptures'));
    expect(block).toContain("combatEffects.spawnVolley('generic'");
    expect(block).toContain('EFFECT_KIND.explosion');
    expect(block).toContain("ev.kind === 'bombardment'");
    // markers reconcile off engaged armies, not per event
    expect(main).toContain('combatEffects.syncBattles([...seen.values()])');
    // per-frame repack + upload lives in onStats
    expect(main).toContain('combatEffects.collect(');
    expect(main).toContain('renderer.setCombatEffects(packed.floats, packed.count)');
  });
});

describe('locatable notification', () => {
  it('a toast with a focus point is clickable and re-centres the camera', () => {
    expect(notifications).toContain('focusWorld?: (x: number, z: number) => void');
    expect(notifications).toContain("item.classList.add('is-locatable')");
    expect(notifications).toContain('focusWorld(x, z)');
    // The dedicated "under attack" icon is used for a located combat alert.
    expect(notifications).toMatch(/notification\.kind === 'combat' && notification\.focus \? 'note-attacked'/);
  });
});
