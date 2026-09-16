import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const gameUi = readFileSync(path.join(root, 'src/ui/shell/game-ui.ts'), 'utf8');
const mainTs = readFileSync(path.join(root, 'src/app/bootstrap.ts'), 'utf8');

describe('0 A.D.-style production/construction queue', () => {
  it('updates persistent progress nodes instead of rebuilding them on every tick', () => {
    expect(gameUi).toContain('const queueViews = new WeakMap<HTMLElement, QueueView>();');
    expect(gameUi).toContain('if (view.orderKey !== nextOrderKey)');
    expect(gameUi).toContain('slot.mask.style.transform = `translateY(${item.active ? progress : 0}%)`');
    expect(gameUi).toContain('slot.fill.style.width = `${progress}%`');
    expect(gameUi).toContain('formatEta(item.etaSeconds)');
    expect(gameUi).not.toContain('container.replaceChildren(...items.map');
    expect(gameUi).not.toMatch(/Queue:\s*\$\{/);
    expect(gameUi).not.toMatch(/Under construction:\s*\$\{/);
  });

  it('uses separate construction and production treatments with batch counts', () => {
    expect(gameUi).toContain("groupQueueItems(items)");
    expect(gameUi).toContain("slot.count.textContent = `×${item.count}`");
    expect(gameUi).toContain("el('div', 'ifg-queue ifg-queue--production')");
    expect(gameUi).toContain("el('div', 'ifg-queue ifg-queue--construction')");
  });

  it('uses dedicated production pictograms and facility icons without permanent button labels', () => {
    expect(gameUi).toContain('const icon = mode === \'build\' ? FACILITY_ICON[option.id] : UNIT_PRODUCTION_ICON[family];');
    expect(gameUi).toContain("createIcon(icon, 'ifg-province-picker__thumb')");
    expect(gameUi).not.toContain("el('span', 'ifg-buildbtn__label'");
    expect(gameUi).toContain('updateQueue(pvQueue, q, (id, label) => {');
    expect(gameUi).toContain('const thumb = createUnitPortrait(id, label);');
    expect(gameUi).toContain('const icon = FACILITY_ICON[id];');
  });

  it('re-render cache key encodes progress/eta so a filling bar is not treated as unchanged', () => {
    // The old string-join collapsed every queue item to the same
    // "[object Object]" once queue/construction stopped being string arrays —
    // this pins that the key is built from the actual fields instead.
    expect(gameUi).toContain('${q.id}:${Math.round(q.progress * 100)}:${Math.round(q.etaSeconds)}');
  });

  it('computes eta from the centralized simulation rate and unified multiplier', () => {
    expect(mainTs).toContain('GAME_PACE.clock.simulationHoursPerRealSecond');
    expect(mainTs).toContain('(activeSession?.devSimSpeed ?? 1)');
  });

  it('disables province actions while intent is pending and uses server affordability', () => {
    expect(gameUi).toContain("selected.commandPending === true || !option.affordable || !option.available");
    expect(gameUi).toContain("province.canSetRally ? 'rally-ok' : 'rally-blocked'");
    expect(mainTs).toContain('session.productionOptions(provinceId)');
    expect(mainTs).toContain('commandPending: session.pendingForProvince(provinceId)');
  });
});
