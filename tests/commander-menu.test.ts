import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const html = readFileSync(path.join(root, 'index.html'), 'utf8');
const commander = readFileSync(path.join(root, 'src/menu/commander.ts'), 'utf8');
const menu = readFileSync(path.join(root, 'src/menu/menu.ts'), 'utf8');

/**
 * P4: identity moves out of the footer's full-width "Log out" row into a
 * compact top-corner commander chip that expands to a service record. All
 * numbers come from the persisted CommanderProfile; nothing is invented and
 * nothing authoritative lives in localStorage.
 */
describe('commander / service record', () => {
  it('removes the footer log-out button and account name', () => {
    expect(html).not.toContain('id="ifm-logout"');
    expect(html).not.toContain('id="ifm-account-name"');
    expect(html).toContain('id="commander"');
    expect(menu).not.toContain("requiredId<HTMLButtonElement>('ifm-logout')");
  });

  it('renders progression from the real profile, defaulting a missing one to a fresh L1', () => {
    expect(commander).toContain('CommanderProfile');
    expect(commander).toMatch(/level:\s*1,\s*xp:\s*0/); // the explicit fresh-record default
    expect(commander).toContain('profile.xpIntoLevel');
    expect(commander).toContain('profile.achievements');
    // no fabricated fallbacks
    expect(commander).not.toMatch(/Math\.random|xp:\s*[1-9]/);
  });

  it('shows a real commendations list, empty for a new commander', () => {
    expect(commander).toContain('No commendations recorded');
  });

  it('does not treat localStorage as progression state', () => {
    expect(commander).not.toMatch(/localStorage\s*[.[]/);
    expect(commander).not.toContain('sessionStorage');
  });

  it('uses a local insignia asset, never an emoji', () => {
    expect(commander).toContain("import.meta.glob('../ui/assets/ranks/*.svg'");
    // eslint/no-emoji isn't a thing here, so assert no non-ASCII pictographs in the source
    expect(/\p{Extended_Pictographic}/u.test(commander)).toBe(false);
  });

  it('keeps Log Out inside the expandable record, not the menu chrome', () => {
    expect(commander).toContain('id="commander-logout"');
    expect(commander).toMatch(/commander-logout[\s\S]{0,120}handlers\.onLogout/);
  });

  it('exposes a server-authoritative XP entry point for future awards', () => {
    const store = readFileSync(path.join(root, 'apps/auth-server/src/auth-store.ts'), 'utf8');
    expect(store).toContain('grantCommanderProgress(');
    expect(store).toContain('CREATE TABLE IF NOT EXISTS commander_profiles');
  });

  it('returns the profile on the session and a dedicated endpoint', () => {
    const main = readFileSync(path.join(root, 'apps/auth-server/src/main.ts'), 'utf8');
    expect(main).toContain('profile: store.commanderProfile(account.id)');
    expect(main).toContain("url.pathname === '/v1/profile'");
  });
});
