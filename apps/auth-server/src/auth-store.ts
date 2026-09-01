import { randomBytes, randomUUID, scrypt as nodeScrypt, timingSafeEqual, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { type CommanderProfile, commanderProfileFromXp } from '@ironfronts/protocol';

const scrypt = promisify(nodeScrypt);

export interface Account {
  id: string;
  username: string;
  normalizedUsername: string;
  passwordHash: string;
  passwordSalt: string;
}

interface AccountRow {
  id: string;
  username: string;
  normalized_username: string;
  password_hash: string;
  password_salt: string;
}

function accountFromRow(row: AccountRow): Account {
  return {
    id: row.id,
    username: row.username,
    normalizedUsername: row.normalized_username,
    passwordHash: row.password_hash,
    passwordSalt: row.password_salt,
  };
}

/** SQLite-backed account/session repository. `:memory:` remains useful for isolated tests. */
export class AuthStore {
  private readonly database: DatabaseSync;
  private readonly pendingRegistrations = new Set<string>();

  constructor(databasePath = ':memory:') {
    this.database = new DatabaseSync(databasePath);
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (databasePath !== ':memory:') this.database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        normalized_username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS sessions_account_id ON sessions(account_id);
      CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS commander_profiles (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        xp INTEGER NOT NULL DEFAULT 0,
        achievements TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      ) STRICT;
    `);
  }

  /**
   * Commander progression for an account, creating the default row
   * (`level 1, 0 XP, no commendations`) on first access. `level` is derived
   * from stored `xp`, never persisted separately.
   */
  commanderProfile(accountId: string): CommanderProfile {
    const row = this.database
      .prepare('SELECT xp, achievements FROM commander_profiles WHERE account_id = ?')
      .get(accountId) as { xp: number; achievements: string } | undefined;
    if (!row) {
      const now = Date.now();
      this.database.prepare(`
        INSERT INTO commander_profiles (account_id, xp, achievements, created_at, updated_at)
        VALUES (?, 0, '[]', ?, ?)
        ON CONFLICT(account_id) DO NOTHING
      `).run(accountId, now, now);
      return commanderProfileFromXp(0, []);
    }
    let achievements: string[] = [];
    try {
      const parsed = JSON.parse(row.achievements) as unknown;
      if (Array.isArray(parsed)) achievements = parsed.filter((entry): entry is string => typeof entry === 'string');
    } catch { /* corrupt row — treat as no commendations */ }
    return commanderProfileFromXp(row.xp, achievements);
  }

  /**
   * Award XP and/or achievements. No gameplay path calls this yet; it is the
   * server-authoritative entry point for when XP is designed. Returns the
   * updated profile.
   */
  grantCommanderProgress(
    accountId: string,
    { xp = 0, achievements = [] }: { xp?: number; achievements?: string[] },
  ): CommanderProfile {
    this.commanderProfile(accountId); // ensure a row exists
    const current = this.database
      .prepare('SELECT xp, achievements FROM commander_profiles WHERE account_id = ?')
      .get(accountId) as { xp: number; achievements: string };
    const merged = new Set<string>();
    try {
      for (const entry of JSON.parse(current.achievements) as unknown[]) {
        if (typeof entry === 'string') merged.add(entry);
      }
    } catch { /* ignore corrupt row */ }
    for (const entry of achievements) merged.add(entry);
    const nextXp = Math.max(0, current.xp + Math.max(0, Math.floor(xp)));
    this.database.prepare(`
      UPDATE commander_profiles SET xp = ?, achievements = ?, updated_at = ? WHERE account_id = ?
    `).run(nextXp, JSON.stringify([...merged]), Date.now(), accountId);
    return commanderProfileFromXp(nextXp, [...merged]);
  }

  async register(username: string, password: string): Promise<Account> {
    const normalizedUsername = normalizeUsername(username);
    validatePassword(password);
    const existing = this.database.prepare('SELECT 1 FROM accounts WHERE normalized_username = ?').get(normalizedUsername);
    if (existing || this.pendingRegistrations.has(normalizedUsername)) throw new Error('Username is already registered.');
    this.pendingRegistrations.add(normalizedUsername);
    try {
      const salt = randomBytes(16).toString('base64url');
      const passwordHash = (await scrypt(password, salt, 64) as Buffer).toString('base64url');
      const account = { id: randomUUID(), username: username.trim(), normalizedUsername, passwordHash, passwordSalt: salt };
      try {
        this.database.prepare(`
          INSERT INTO accounts (id, username, normalized_username, password_hash, password_salt, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(account.id, account.username, account.normalizedUsername, account.passwordHash, account.passwordSalt, Date.now());
      } catch (error) {
        if (/unique|constraint/i.test(error instanceof Error ? error.message : String(error))) {
          throw new Error('Username is already registered.');
        }
        throw error;
      }
      return account;
    } finally {
      this.pendingRegistrations.delete(normalizedUsername);
    }
  }

  async authenticate(username: string, password: string): Promise<Account | null> {
    const normalized = username.trim().toLocaleLowerCase('en-US');
    const row = this.database.prepare(`
      SELECT id, username, normalized_username, password_hash, password_salt
      FROM accounts WHERE normalized_username = ?
    `).get(normalized) as unknown as AccountRow | undefined;
    if (!row) {
      await scrypt(password, 'invalid-account-timing-salt', 64);
      return null;
    }
    const account = accountFromRow(row);
    const supplied = await scrypt(password, account.passwordSalt, 64) as Buffer;
    const expected = Buffer.from(account.passwordHash, 'base64url');
    return supplied.length === expected.length && timingSafeEqual(supplied, expected) ? account : null;
  }

  createSession(accountId: string, ttlMs: number): { token: string; expiresAt: number } {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + ttlMs;
    this.database.prepare(`
      INSERT INTO sessions (token_hash, account_id, expires_at, created_at) VALUES (?, ?, ?, ?)
    `).run(hashToken(token), accountId, expiresAt, Date.now());
    return { token, expiresAt };
  }

  sessionAccount(token: string | undefined): Account | null {
    if (!token) return null;
    const tokenHash = hashToken(token);
    const row = this.database.prepare(`
      SELECT a.id, a.username, a.normalized_username, a.password_hash, a.password_salt, s.expires_at
      FROM sessions s JOIN accounts a ON a.id = s.account_id
      WHERE s.token_hash = ?
    `).get(tokenHash) as unknown as (AccountRow & { expires_at: number }) | undefined;
    if (!row) return null;
    if (row.expires_at <= Date.now()) {
      this.database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      return null;
    }
    return accountFromRow(row);
  }

  revoke(token: string | undefined): void {
    if (token) this.database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }

  cleanup(): void {
    this.database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  }

  close(): void { this.database.close(); }
}

function hashToken(token: string): string { return createHash('sha256').update(token).digest('base64url'); }
function normalizeUsername(username: string): string {
  const trimmed = username.trim();
  if (!/^[\p{L}\p{N}_ .-]{3,32}$/u.test(trimmed)) throw new Error('Username must be 3–32 characters.');
  return trimmed.toLocaleLowerCase('en-US');
}
function validatePassword(password: string): void {
  if (password.length < 8 || password.length > 256) throw new Error('Password must be 8–256 characters.');
}
