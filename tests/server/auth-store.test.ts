import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AuthStore } from '../../apps/auth-server/src/auth-store';

describe('SQLite authentication store', () => {
  it('hashes passwords, treats usernames case-insensitively, and authenticates', async () => {
    const store = new AuthStore();
    const account = await store.register('FieldMarshal', 'correct horse battery');
    expect(account.passwordHash).not.toContain('correct horse battery');
    expect(account.passwordSalt.length).toBeGreaterThan(10);
    await expect(store.register('fieldmarshal', 'another password')).rejects.toThrow(/already/i);
    expect((await store.authenticate('FIELDMARSHAL', 'correct horse battery'))?.id).toBe(account.id);
    expect(await store.authenticate('FieldMarshal', 'wrong password')).toBeNull();
  });

  it('creates opaque revocable sessions and expires them', async () => {
    const store = new AuthStore();
    const account = await store.register('Commander', 'eight-letters');
    const active = store.createSession(account.id, 10_000);
    expect(store.sessionAccount(active.token)?.id).toBe(account.id);
    store.revoke(active.token);
    expect(store.sessionAccount(active.token)).toBeNull();
    const expired = store.createSession(account.id, -1);
    expect(store.sessionAccount(expired.token)).toBeNull();
  });

  it('allows only one winner in a case-insensitive registration race', async () => {
    const store = new AuthStore();
    const outcomes = await Promise.allSettled([
      store.register('RaceUser', 'first-password'),
      store.register('raceuser', 'second-password'),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
  });

  it('provisions admin, preserves identity and progress, and revokes sessions only when its password changes', async () => {
    const store = new AuthStore();
    await store.ensureAdminAccount('first-admin-password');
    const original = await store.authenticate('admin', 'first-admin-password');
    expect(original).not.toBeNull();
    const id = original!.id;
    store.grantCommanderProgress(id, { xp: 100 });
    const session = store.createSession(id, 60_000);

    await store.ensureAdminAccount('first-admin-password');
    expect(store.sessionAccount(session.token)?.id).toBe(id);

    await store.ensureAdminAccount('replacement-admin-password');
    expect(await store.authenticate('admin', 'first-admin-password')).toBeNull();
    expect((await store.authenticate('ADMIN', 'replacement-admin-password'))?.id).toBe(id);
    expect(store.commanderProfile(id).xp).toBe(100);
    expect(store.sessionAccount(session.token)).toBeNull();
    store.close();
  });

  it('restores accounts and sessions from a SQLite file after restart', async () => {
    const directory = await mkdtemp(path.join(tmpdir(), 'ironfronts-auth-'));
    const databasePath = path.join(directory, 'auth.sqlite');
    try {
      const first = new AuthStore(databasePath);
      const account = await first.register('PersistentUser', 'persistent-password');
      const session = first.createSession(account.id, 60_000);
      first.close();

      const restored = new AuthStore(databasePath);
      expect((await restored.authenticate('persistentuser', 'persistent-password'))?.id).toBe(account.id);
      expect(restored.sessionAccount(session.token)?.id).toBe(account.id);
      restored.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
