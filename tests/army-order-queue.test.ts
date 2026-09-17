import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const bootstrap = readFileSync(path.join(process.cwd(), 'src/app/bootstrap.ts'), 'utf8');

describe('map attack targeting and Shift order queue', () => {
  it('gives an enemy province centre priority over a co-located army marker', () => {
    const helper = bootstrap.slice(
      bootstrap.indexOf('function attackOrderAt('),
      bootstrap.indexOf('function flashAttackTarget('),
    );
    expect(helper.indexOf('pickProvinceCenterAt')).toBeGreaterThanOrEqual(0);
    expect(helper.indexOf('pickProvinceCenterAt')).toBeLessThan(helper.indexOf('pickArmyAt'));
    expect(helper).toContain("kind: 'attackProvince', provinceId: centerProvinceId");
  });

  it('queues typed move, province-attack, and army-attack orders', () => {
    expect(bootstrap).toContain("| { kind: 'move'; x: number; z: number }");
    expect(bootstrap).toContain("| { kind: 'attackProvince'; provinceId: number; x: number; z: number }");
    expect(bootstrap).toContain("| { kind: 'attackArmy'; targetArmyId: string }");
    expect(bootstrap).toContain("lastArmyOrderMode.set(selectedArmyId, 'attack')");
    expect(bootstrap).toContain('issueQueuedArmyOrder(session, armyId, next)');
  });
});
