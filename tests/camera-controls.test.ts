import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const camera = readFileSync(path.join(root, 'src/rendering/camera.ts'), 'utf8');
const renderer = readFileSync(path.join(root, 'src/rendering/renderer.ts'), 'utf8');
const main = readFileSync(path.join(root, 'src/app/bootstrap.ts'), 'utf8');

/** Playtest #2 + #6: deterministic top-down spawn, and right-click issues orders. */
describe('camera + order controls', () => {
  it('reserves right mouse for orders — left orbits, middle pans', () => {
    const start = camera.indexOf('private onPointerDown');
    const body = camera.slice(start, camera.indexOf('private onPointerMove', start));
    // No more `button === 2 -> orbit`.
    expect(body).not.toContain("event.button === 2 ? 'orbit'");
    expect(body).toContain("event.button === 0 ? 'orbit' : 'pan'");
    // Left and middle are the only mouse buttons the camera acts on.
    expect(body).toMatch(/button !== 0 && event\.button !== 1/);
  });

  it('lets the orbit clamp reach the near-top-down start pitch', () => {
    expect(camera).toMatch(/clamp\(this\.pitch \+ dy \* [0-9.]+, 0\.43, 1\.45\)/);
  });

  it('has a deterministic north-up, near-top-down player-start view', () => {
    expect(renderer).toContain('const PLAYER_START_YAW = 0;');
    expect(renderer).toMatch(/const PLAYER_START_PITCH = 1\.4[0-9]?;/);
    expect(renderer).toContain('focusPlayerStart(x: number, z: number, distance: number)');
    // The launch path uses it instead of the angled generic default.
    expect(main).toContain('renderer.focusPlayerStart(x, z, distance)');
    expect(main).not.toMatch(/renderer\.focus\(x, z, distance\)\s*;/);
  });

  it('right-click orders the selected army (attack detected hostile, else move)', () => {
    expect(renderer).toContain('onMapCommand?: (clientX: number, clientY: number) => boolean');
    expect(renderer).toMatch(/addEventListener\('contextmenu'[\s\S]{0,120}onMapCommand\?\.\(/);
    const start = main.indexOf('function handleMapCommand(');
    const body = main.slice(start, main.indexOf('function selectArmy(', start));
    expect(body).toContain('if (!selectedArmyId || !session.ownsArmy(selectedArmyId)) {');
    expect(body).toContain('session.orderAttackArmy(selectedArmyId, targetArmyId)');
    expect(body).toContain("session.orderMove(selectedArmyId, ground[0], ground[1], 'move')");
    // A direct order clears any half-armed targeting mode.
    expect(body).toContain('targetingMode = null;');
  });

  it('right-click also places/clears the rally point of a selected own city when no army is selected', () => {
    const start = main.indexOf('function handleMapCommand(');
    const body = main.slice(start, main.indexOf('function selectArmy(', start));
    // Right-clicking the selected city itself clears its rally point...
    expect(body).toMatch(/clickedProvinceId === selectedProvinceId[\s\S]{0,80}session\.clearRally\(selectedProvinceId/);
    // ...right-clicking anywhere else in owned/discovered ground sets it there.
    expect(body).toContain('session.setRally(selectedProvinceId, ground[0], ground[1],');
  });
});
