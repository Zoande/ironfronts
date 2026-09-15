import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const main = readFileSync(path.join(root, 'src/app/bootstrap.ts'), 'utf8');
const notifications = readFileSync(path.join(root, 'src/ui/notifications.ts'), 'utf8');

describe('attack-order feedback', () => {
  it('shows the attack cursor for both identified enemies and contact-only blips', () => {
    const fn = main.slice(main.indexOf('const updateWorldCursor ='), main.indexOf('canvas.addEventListener(\'pointermove\''));
    expect(fn).toContain('Boolean(hovered && !hovered.own)');
    expect(fn).not.toMatch(/hovered\.contact === 'visible'/);
    expect(fn).toContain('action-attack.png');
    expect(fn).toContain('cursor-no.png');
  });

  it('lets armed attack mode pass contact-only army targets to the server', () => {
    const branch = main.slice(main.indexOf("targetingMode === 'attack' && selectedArmyId"), main.indexOf("targetingMode === 'retreat'", main.indexOf("targetingMode === 'attack' && selectedArmyId")));
    expect(branch).toContain('session.orderAttackArmy(selectedArmyId, targetArmyId, acknowledgeAttack)');
    expect(branch).not.toContain("pickedTarget.contact !== 'visible'");
    expect(branch).not.toContain('Only a force in direct view can be attacked');
  });

  it('drives distinct world cursors for rally placement and ground-order aiming', () => {
    const fn = main.slice(main.indexOf('const updateWorldCursor ='), main.indexOf('canvas.addEventListener(\'pointermove\''));
    expect(fn).toContain('cursors/cursor-rally.png');
    // Shown whenever an own city is selected and no army is armed for an
    // order — right-click sets/clears the rally directly, no arm step.
    expect(fn).toMatch(/selectedProvinceId !== null[\s\S]{0,120}session\.ownsProvince\(selectedProvinceId\)/);
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
    expect(branch).toMatch(/session\.orderAttackProvince\([\s\S]*provinceId, ground\[0\], ground\[1\], acknowledgeAttack/);
    expect(branch).not.toMatch(/}\s*else\s*{\s*\n\s*flashAttackTarget/);
  });

  it('threads onAccepted through the war-confirmation re-send', () => {
    const remote = readFileSync(path.join(root, 'src/client/remote-session.ts'), 'utf8');
    expect(remote).toContain('onAccepted?: () => void');
    expect(remote).toContain('onAccepted?.();');
    // re-send after respond(true) keeps the same callback
    expect(remote).toContain('this.send(confirmedCommand, onAccepted);');
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

describe('combat huddle (visual-only positioning)', () => {
  it('groups engaged armies by their authoritative front id, then nudges only the displayed armyMotion', () => {
    const start = main.indexOf('// Combat huddle (visual only)');
    const block = main.slice(start, main.indexOf('for (const army of Object.values(session.state.armies)) {', start) + 4_000);
    // Anchors are grouped by the front id each engaged army reports (not a
    // distance/grid heuristic), so no pair the sim considers engaged can be missed.
    expect(block).toMatch(/Object\.values\(session\.state\.armies\)\s*\.filter\(\(a\) => a\.status === 'engaged'\)/);
    expect(block).toContain('frontIds: (a.battleFronts ?? []).map((f) => f.id)');
    expect(block).toContain('buildBattleAnchors(groupEngagedByFront(');
    expect(block).toContain("army.status === 'engaged' ? battleAnchors.get(army.id) : undefined");
    expect(block).toContain('combatHuddleOffset({ x: army.x, z: army.z }, battleAnchor)');
    // The offset is added to a fresh object (armyMotionRaw spread), never assigned back onto army.x/z.
    expect(block).toMatch(/const armyMotion = huddle[\s\S]{0,160}\.\.\.armyMotionRaw,\s*x: armyMotionRaw\.x \+ huddle\.x,\s*z: armyMotionRaw\.z \+ huddle\.z,\s*targetX: armyMotionRaw\.targetX \+ huddle\.x,\s*targetZ: armyMotionRaw\.targetZ \+ huddle\.z,/);
    expect(block).not.toMatch(/army\.x\s*=/);
    expect(block).not.toMatch(/army\.z\s*=/);
  });

  it('never reassigns session.state.armies coordinates anywhere in main.ts', () => {
    // The huddle offset must be a pure render-layer transform: grep the whole
    // file for any write to an army's authoritative x/z (armyMotion/huddle
    // locals are fine; session.state.armies entries must never be mutated).
    expect(main).not.toMatch(/session\.state\.armies\[[^\]]+\]\.x\s*=/);
    expect(main).not.toMatch(/\barmy\.x\s*=\s*(?!==)/);
    expect(main).not.toMatch(/\barmy\.z\s*=\s*(?!==)/);
  });
});

describe('continuous battle FX (gunfire, smoke stalk, city-under-siege overlay)', () => {
  it('spawns ongoing FX per authoritative battle-front cluster, at the same centroid the huddle uses, gated on camera LOD', () => {
    const start = main.indexOf('function spawnOngoingBattleFx');
    const block = main.slice(start, main.indexOf('\nfunction drainSessionEvents', start));
    expect(block).toContain('effectDensityForDistance(lastCombatCameraDistance)');
    // Groups the same way the huddle above does — a cluster only exists
    // because a fully-visible engaged army reported that front id, so no
    // separate owner-diversity check is needed (and none would fire FX for
    // the player's own engaged army against a fog-obscured enemy).
    expect(block).toContain('groupEngagedByFront(');
    expect(block).not.toContain('ownerCountryIds.size < 2');
    // Gunshots: more frequent than the single spawnVolley the 'engaged'/'combatPulse' events already fire.
    expect(block).toContain("combatEffects.spawnVolley('infantry', cluster.x, cluster.z");
    // Smoke reuses the same EFFECT_KIND.smoke WGSL composition as the nuke's smoke stalk, smaller/continuous.
    expect(block).toContain('EFFECT_KIND.smoke');
    expect(block).toMatch(/lifetimeMs: 2_400/);
    // City-under-siege: resolve the province from the fight's own centroid
    // (the projection never ships a front's province id) and only act when it
    // actually has buildings.
    expect(block).toContain('renderer.provinceIdAtWorld(cluster.x, cluster.z)');
    expect(block).toContain('session.state.provinceBuildings[provinceId]');
    expect(block).toContain('buildingCount <= 0) continue');
    expect(block).toContain('EFFECT_KIND.explosion');
  });

  it('is wired into the 400ms HUD timer alongside syncCombatMarkers', () => {
    const timerStart = main.indexOf('const hudTimer = window.setInterval(');
    const timerBlock = main.slice(timerStart, main.indexOf('}, 400);', timerStart));
    expect(timerBlock).toContain('syncCombatMarkers(session);');
    expect(timerBlock).toContain('spawnOngoingBattleFx(session, renderer);');
  });
});
