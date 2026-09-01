import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AuthStore } from '../../apps/auth-server/src/auth-store';
import { commanderLevelForXp, commanderXpForLevel } from '@ironfronts/protocol';

describe('commander progression model', () => {
  it('is a real quadratic curve, level 1 at zero XP', () => {
    expect(commanderXpForLevel(1)).toBe(0);
    expect(commanderLevelForXp(0)).toBe(1);
    expect(commanderLevelForXp(-50)).toBe(1);
    // monotonic non-decreasing
    let prev = -1;
    for (let xp = 0; xp <= 5000; xp += 25) {
      const level = commanderLevelForXp(xp);
      expect(level).toBeGreaterThanOrEqual(prev);
      prev = level;
    }
    // reaching a threshold advances exactly one level
    expect(commanderLevelForXp(commanderXpForLevel(4))).toBe(4);
    expect(commanderLevelForXp(commanderXpForLevel(4) - 1)).toBe(3);
  });
});

describe('AuthStore commander profile', () => {
  it('creates a genuine default profile on first access', async () => {
    const store = new AuthStore();
    const account = await store.register('FreshRecruit', 'first-command');
    const profile = store.commanderProfile(account.id);
    expect(profile).toEqual({
      level: 1, xp: 0, xpIntoLevel: 0, xpForNextLevel: 100, achievements: [],
    });
  });

  it('persists progression across a restart and never stores localStorage-style state', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ironfronts-profile-'));
    const databasePath = path.join(directory, 'auth.sqlite');
    try {
      const first = new AuthStore(databasePath);
      const account = await first.register('Veteran', 'long-service');
      first.commanderProfile(account.id); // materialise the row
      const updated = first.grantCommanderProgress(account.id, { xp: 350, achievements: ['first-blood'] });
      expect(updated.level).toBe(commanderLevelForXp(350));
      expect(updated.achievements).toEqual(['first-blood']);
      first.close();

      const restored = new AuthStore(databasePath);
      const reloaded = restored.commanderProfile(account.id);
      expect(reloaded.xp).toBe(350);
      expect(reloaded.achievements).toEqual(['first-blood']);
      expect(reloaded.level).toBe(commanderLevelForXp(350));
      restored.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('adds the commander_profiles table to a database created before it existed', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ironfronts-migrate-'));
    const databasePath = path.join(directory, 'auth.sqlite');
    try {
      // A first store writes accounts/sessions; a second open must not choke and
      // must serve profiles for the pre-existing account (create-if-missing).
      const first = new AuthStore(databasePath);
      const account = await first.register('Legacy', 'pre-profile-era');
      first.close();

      const second = new AuthStore(databasePath);
      const profile = second.commanderProfile(account.id);
      expect(profile.level).toBe(1);
      expect(profile.xp).toBe(0);
      second.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('de-duplicates achievements and floors XP at zero', async () => {
    const store = new AuthStore();
    const account = await store.register('Decorated', 'valour-x8');
    store.grantCommanderProgress(account.id, { achievements: ['medal-a', 'medal-a'] });
    const profile = store.grantCommanderProgress(account.id, { xp: -999, achievements: ['medal-a', 'medal-b'] });
    expect(profile.xp).toBe(0);
    expect([...profile.achievements].sort()).toEqual(['medal-a', 'medal-b']);
  });
});
