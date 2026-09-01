import type { CommanderProfile } from '@ironfronts/protocol';

// Inlined as markup (not a URL) so the insignia inherits `currentColor`.
const rankSvgs = import.meta.glob('../ui/assets/ranks/*.svg', {
  eager: true, query: '?raw', import: 'default',
}) as Record<string, string>;

/** Level band -> {title, insignia asset stem}. Purely presentational. */
const RANKS: ReadonlyArray<{ minLevel: number; title: string; stem: string }> = [
  { minLevel: 15, title: 'High Command', stem: 'command' },
  { minLevel: 10, title: 'Field Officer', stem: 'field' },
  { minLevel: 6, title: 'Staff Officer', stem: 'staff' },
  { minLevel: 3, title: 'Officer', stem: 'officer' },
  { minLevel: 1, title: 'Recruit', stem: 'recruit' },
];

function rankFor(level: number): { title: string; svg: string } {
  const rank = RANKS.find((entry) => level >= entry.minLevel) ?? RANKS[RANKS.length - 1];
  return { title: rank.title, svg: rankSvgs[`../ui/assets/ranks/${rank.stem}.svg`] ?? '' };
}

export interface CommanderHandlers {
  username: string;
  /** Absent only if the auth server did not return one; treated as a fresh L1 record. */
  profile?: CommanderProfile;
  onLogout: () => void;
}

/**
 * Compact commander identity in the menu's top corner. Click to expand the
 * service record (rank, level, XP, commendations) where Log Out also lives —
 * there is no longer a full-width Log Out button in the footer.
 *
 * All numbers come from the persisted `CommanderProfile`; a new account really
 * is Recruit / Level 1 / 0 XP / no commendations. Nothing here is invented, and
 * progression is never read from or written to browser storage.
 */
export function mountCommander(handlers: CommanderHandlers): void {
  const root = document.getElementById('commander');
  if (!root) return;

  const profile: CommanderProfile = handlers.profile
    ?? { level: 1, xp: 0, xpIntoLevel: 0, xpForNextLevel: 100, achievements: [] };
  const rank = rankFor(profile.level);
  const pct = profile.xpForNextLevel > 0
    ? Math.min(100, Math.round((profile.xpIntoLevel / profile.xpForNextLevel) * 100))
    : 0;
  const commendations = profile.achievements.length
    ? profile.achievements.map((id) => `<li>${escapeHtml(id)}</li>`).join('')
    : '<li class="commander__none">No commendations recorded</li>';

  root.innerHTML = `
    <button type="button" class="commander__chip" id="commander-toggle" aria-expanded="false" aria-controls="commander-record">
      <span class="commander__insignia" aria-hidden="true">${rank.svg}</span>
      <span class="commander__ident">
        <b>${escapeHtml(handlers.username)}</b>
        <span>Level ${profile.level} &middot; ${escapeHtml(rank.title)}</span>
        <span class="commander__xp"><i style="width:${pct}%"></i></span>
      </span>
    </button>
    <div class="commander__record" id="commander-record" hidden>
      <p class="commander__record-eyebrow">Service Record</p>
      <dl class="commander__stats">
        <div><dt>Rank</dt><dd>${escapeHtml(rank.title)}</dd></div>
        <div><dt>Level</dt><dd>${profile.level}</dd></div>
        <div><dt>Experience</dt><dd>${profile.xpIntoLevel} / ${profile.xpForNextLevel} <span>(${profile.xp} total)</span></dd></div>
        <div><dt>Active operations</dt><dd id="commander-operations">&mdash;</dd></div>
      </dl>
      <p class="commander__record-eyebrow">Commendations</p>
      <ul class="commander__commendations">${commendations}</ul>
      <button type="button" class="commander__logout" id="commander-logout">Log out</button>
    </div>
  `;

  const toggle = root.querySelector<HTMLButtonElement>('#commander-toggle')!;
  const record = root.querySelector<HTMLElement>('#commander-record')!;
  const setOpen = (open: boolean): void => {
    record.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    root.classList.toggle('is-open', open);
  };
  toggle.addEventListener('click', () => setOpen(record.hidden));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !record.hidden) setOpen(false);
  });
  document.addEventListener('pointerdown', (event) => {
    if (!record.hidden && !root.contains(event.target as Node)) setOpen(false);
  });
  root.querySelector<HTMLButtonElement>('#commander-logout')!.addEventListener('click', handlers.onLogout);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch
  ));
}
