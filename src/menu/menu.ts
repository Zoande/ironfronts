import './menu.css';
import type { AudioManager, UiAudioCue } from '../audio/audio-manager';
import {
  isQualityLevel, loadQuality, QUALITY_PRESETS, saveQuality, type QualityLevel,
} from '../graphics/quality';
import type { CommanderProfile, GameLobby } from '@ironfronts/protocol';
import { assignedCountry as resolveAssignedCountry, selectableCountries } from './lobby-state';
import { resolveFlagUrl } from '../ui/flags';
import { mountCommander } from './commander';

export interface MenuHandlers {
  /**
   * Called once the player commits to entering the world, with the typed
   * scenario + country selection. Nothing downstream re-reads the DOM.
   */
  lobby: GameLobby;
  username: string;
  /** Persisted commander progression from the auth server's session response. */
  profile?: CommanderProfile;
  onLaunch: (countryId: number) => void | Promise<void>;
  onLogout: () => void;
  audio?: AudioManager;
  /**
   * Fired when the player changes the graphics-quality preset in Settings.
   * In the lobby this only persists the choice; once a WorldRenderer exists
   * (after launch) main.ts forwards it to renderer.setQuality.
   */
  onGraphicsQuality?: (level: QualityLevel) => void;
}

/**
 * Hard ceiling on how long a dossier open/close may hold `busy`. The visual
 * transition is a pure CSS `transition` on the compositor (see menu.css), so it
 * keeps running even if the main thread or rAF is momentarily starved; this
 * timeout only bounds the JS-side `busy` flag if `transitionend` never fires.
 */
const TRANSITION_TIMEOUT_MS = 680;

export function mountMenu(handlers: MenuHandlers): void {
  const root = requiredId<HTMLElement>('menu-root');
  const brand = document.querySelector<HTMLElement>('.brand');
  const masterVolume = document.getElementById('ifm-master-volume') as HTMLInputElement | null;
  const musicVolume = document.getElementById('ifm-music-volume') as HTMLInputElement | null;
  const newCampaign = requiredId<HTMLButtonElement>('ifm-new-campaign');
  const continueButton = requiredId<HTMLButtonElement>('ifm-continue');
  const assignedCountry = resolveAssignedCountry(handlers.lobby);
  mountCommander({
    username: handlers.username,
    profile: handlers.profile,
    onLogout: handlers.onLogout,
  });
  // A second campaign slot is not implemented yet. Rather than lock New
  // Campaign entirely once a campaign exists, keep it open as a clearly
  // labelled *preview* of the nation-selection flow that can never deploy —
  // so the existing save is untouchable from here.
  const previewOnly = assignedCountry !== null;
  newCampaign.disabled = false;
  newCampaign.classList.remove('is-disabled');
  newCampaign.classList.toggle('is-preview', previewOnly);
  if (previewOnly) {
    const sub = newCampaign.querySelector('small');
    if (sub) sub.textContent = "Inspect the setup flow — your campaign stays untouched.";
  }
  continueButton.disabled = assignedCountry === null;
  continueButton.classList.toggle('is-disabled', assignedCountry === null);
  continueButton.classList.toggle('is-assigned', assignedCountry !== null);
  requiredId<HTMLElement>('ifm-continue-detail').textContent = assignedCountry
    ? `${assignedCountry.name} — resume where you left off.` : 'No field assignment.';
  if (assignedCountry) {
    continueButton.addEventListener('click', () => void deploy(assignedCountry.id));
    const flagUrl = resolveFlagUrl(assignedCountry.name);
    if (flagUrl) {
      const icon = continueButton.querySelector<HTMLElement>('.ifm__icon');
      // Quote the URL: resolveFlagUrl can return a data: URI whose commas /
      // parens would break an unquoted url().
      if (icon) icon.style.setProperty('--flag', `url("${flagUrl}")`);
      else continueButton.classList.remove('is-assigned');
    } else {
      continueButton.classList.remove('is-assigned');
    }
  }

  let busy = false;
  let openScreen: string | null = null;

  const playCue = (cue: UiAudioCue): void => {
    if (!handlers.audio) return;
    void handlers.audio.playUiCue(cue).catch((error) => {
      console.warn(`Ignoring non-critical UI audio failure for "${cue}".`, error);
    });
  };

  if (handlers.audio) {
    if (masterVolume) {
      masterVolume.value = String(Math.round(handlers.audio.getVolume('master') * 100));
      masterVolume.addEventListener('input', () => {
        handlers.audio?.setVolume('master', Number(masterVolume.value) / 100);
      });
    }
    if (musicVolume) {
      musicVolume.value = String(Math.round(handlers.audio.getVolume('music') * 100));
      musicVolume.addEventListener('input', () => {
        handlers.audio?.setVolume('music', Number(musicVolume.value) / 100);
      });
    }

    root.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
      button.addEventListener('pointerenter', () => playCue('hover'));
    });
  }

  /**
   * Play the dossier open (`direction === 1`) or close (`-1`) transition.
   *
   * All three moving layers — the desk backdrop, the main menu screen, and the
   * dossier — animate via plain CSS `transition`s keyed off the `.is-dossier-open`
   * / `.is-open` classes (see menu.css). Those run on the compositor and cannot
   * be stalled by main-thread or rAF starvation, which is exactly the failure the
   * earlier rAF-driven version hit. JS only flips a class and waits for
   * `transitionend`, with a timeout so `busy` is released even if the event is
   * missed.
   */
  function playTransition(page: HTMLElement, direction: 1 | -1): Promise<void> {
    root.classList.add('is-transitioning');

    if (direction === 1) {
      // display:none -> visible needs a reflow before the class flip so the
      // browser has a "from" state to animate out of.
      page.hidden = false;
      void page.offsetWidth;
      page.classList.add('is-open');
    } else {
      page.classList.remove('is-open');
    }

    return new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        page.removeEventListener('transitionend', onEnd);
        window.clearTimeout(timer);
        root.classList.remove('is-transitioning');
        resolve();
      };
      const onEnd = (event: TransitionEvent): void => {
        if (event.target === page && event.propertyName === 'opacity') finish();
      };
      page.addEventListener('transitionend', onEnd);
      const timer = window.setTimeout(finish, TRANSITION_TIMEOUT_MS);
    });
  }

  async function openDossier(card: HTMLButtonElement): Promise<void> {
    if (busy) return;
    const name = card.dataset.open;
    if (!name) return;
    const page = document.getElementById(`ifm-${name}`);
    if (!page?.querySelector<HTMLElement>('.ifm__file')) return;

    busy = true;
    openScreen = name;
    // Menu-card interactivity is now driven purely by this class (see menu.css),
    // so it cannot be left stranded by an interrupted transition.
    root.classList.add('is-dossier-open');
    playCue('dossier-open');

    try {
      await playTransition(page, 1);
    } finally {
      busy = false;
    }
  }

  async function closeDossier(): Promise<void> {
    if (busy || !openScreen) return;
    const name = openScreen;
    const page = document.getElementById(`ifm-${name}`);
    if (!page?.querySelector<HTMLElement>('.ifm__file')) {
      // Nothing to animate — still clear the state so the menu stays usable.
      openScreen = null;
      root.classList.remove('is-dossier-open');
      return;
    }

    busy = true;
    playCue('dossier-close');
    try {
      await playTransition(page, -1);
    } finally {
      page.hidden = true;
      page.classList.remove('is-open');
      openScreen = null;
      root.classList.remove('is-dossier-open');
      busy = false;
    }
  }

  /**
   * Hard reset to the primary menu screen. Used when a launch attempt started
   * from an open dossier is abandoned (Return to Command), so the menu never
   * comes back panned, half-open, or with dead cards.
   */
  function resetToMainScreen(): void {
    busy = false;
    closeNationPicker();
    if (openScreen) {
      const page = document.getElementById(`ifm-${openScreen}`);
      if (page) {
        page.hidden = true;
        page.classList.remove('is-open');
      }
      openScreen = null;
    }
    root.classList.remove('is-dossier-open', 'is-transitioning');
    // The pan is entirely class-driven: dropping `is-dossier-open` lets the desk
    // backdrop and #ifm-main ease back on their own transitions — no inline
    // styles to unwind.
  }

  root.querySelectorAll<HTMLButtonElement>('[data-open]').forEach((card) => {
    card.addEventListener('click', () => void openDossier(card));
  });
  root.querySelectorAll<HTMLButtonElement>('[data-back]').forEach((button) => {
    button.addEventListener('click', () => void closeDossier());
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    // The nation overlay is layered above the dossier: Escape backs out of it
    // first, only closing the dossier once nothing is stacked on top.
    if (pickerOpen) { closeNationPicker(); return; }
    void closeDossier();
  });

  // ---- Nation selection overlay (Mobilization Registry) --------------
  // The operation dossier no longer carries the country list; "Begin Operation"
  // opens this dedicated overlay, and only an explicit Confirm launches.
  const nationPicker = document.getElementById('ifm-nation-picker');
  const beginOperation = document.getElementById('ifm-begin-operation') as HTMLButtonElement | null;
  const confirmNation = document.getElementById('ifm-confirm-nation') as HTMLButtonElement | null;
  const nationCancel = document.getElementById('ifm-nation-cancel');
  const nationSelected = document.getElementById('ifm-nation-selected');
  const roster = document.getElementById('ifm-country-grid');
  const countryHint = document.getElementById('ifm-country-hint');
  let selectedCountryId: number | null = null;
  let pickerOpen = false;

  function updateConfirmEnabled(): void {
    const country = selectedCountryId === null
      ? null
      : selectableCountries(handlers.lobby).find((c) => c.id === selectedCountryId) ?? null;
    if (confirmNation) {
      confirmNation.disabled = country === null;
      confirmNation.textContent = previewOnly ? 'Preview only' : 'Confirm';
    }
    if (nationSelected) {
      nationSelected.textContent = country ? `Assigned: ${country.name}` : 'No nation selected';
      nationSelected.classList.toggle('is-ready', country !== null);
    }
    if (countryHint) {
      countryHint.textContent = previewOnly
        ? `Preview of the nation-selection flow. A second campaign slot isn't built yet, so this cannot deploy — your current campaign is safe.`
        : country === null
          ? 'Select the nation you will command.'
          : `${country.name} — confirm to take command for the whole campaign.`;
    }
  }

  function selectRosterEntry(button: HTMLButtonElement): void {
    if (!roster || button.classList.contains('is-unavailable')) return;
    selectedCountryId = Number(button.dataset.countryId);
    for (const other of roster.querySelectorAll('.ifm__country')) {
      const on = other === button;
      other.classList.toggle('is-selected', on);
      other.setAttribute('aria-selected', String(on));
    }
    button.scrollIntoView({ block: 'nearest' });
    playCue('select');
    updateConfirmEnabled();
  }

  function renderRoster(preferCountryId: number | null): void {
    if (!roster) return;
    const playable = selectableCountries(handlers.lobby);
    roster.replaceChildren();
    const keep = preferCountryId !== null && playable.some((c) => c.id === preferCountryId);
    selectedCountryId = keep ? preferCountryId : null;
    for (const country of playable) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'ifm__country';
      button.setAttribute('role', 'option');
      button.dataset.countryId = String(country.id);
      const selected = country.id === selectedCountryId;
      button.setAttribute('aria-selected', String(selected));
      button.classList.toggle('is-selected', selected);
      const flag = document.createElement('span');
      flag.className = 'ifm__country-flag';
      const flagUrl = resolveFlagUrl(country.name);
      if (flagUrl) {
        flag.style.backgroundImage = `url("${flagUrl}")`;
      } else {
        // No period-accurate flag for this entity — a colour standard, not a
        // wrong flag. (docs/flags.md explains which entities these are.)
        flag.classList.add('is-standard');
        flag.style.background = country.color;
      }
      const body = document.createElement('span');
      body.className = 'ifm__country-body';
      const name = document.createElement('span');
      name.className = 'ifm__country-name';
      name.textContent = country.name;
      const meta = document.createElement('span');
      meta.className = 'ifm__country-meta';
      meta.textContent = `${country.startingCities} starting cities`;
      body.append(name, meta);
      button.append(flag, body);
      button.addEventListener('click', () => selectRosterEntry(button));
      roster.append(button);
    }
    updateConfirmEnabled();
  }

  /** Count roster columns from layout so Up/Down move a visual row, not one cell. */
  function rosterColumns(entries: HTMLElement[]): number {
    if (entries.length < 2) return 1;
    const top = entries[0].offsetTop;
    let columns = 1;
    while (columns < entries.length && entries[columns].offsetTop === top) columns += 1;
    return columns;
  }

  /** Arrow-key navigation across the roster grid; Enter/Space confirms. */
  function onRosterKeydown(event: KeyboardEvent): void {
    if (!roster) return;
    const entries = [...roster.querySelectorAll<HTMLButtonElement>('.ifm__country')];
    if (!entries.length) return;
    if (event.key === 'Enter' || event.key === ' ') {
      if (selectedCountryId !== null && !confirmNation?.disabled) { event.preventDefault(); void deployFromPicker(selectedCountryId); }
      return;
    }
    const columns = rosterColumns(entries);
    const deltas: Record<string, number> = {
      ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns,
    };
    const step = deltas[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const current = entries.findIndex((entry) => entry.classList.contains('is-selected'));
    let next = current < 0 ? (step > 0 ? 0 : entries.length - 1) : current + step;
    // Skip unavailable entries; stop at the ends rather than wrapping.
    while (next >= 0 && next < entries.length && entries[next].classList.contains('is-unavailable')) next += step;
    if (next < 0 || next >= entries.length) return;
    selectRosterEntry(entries[next]);
    entries[next].focus();
  }
  roster?.addEventListener('keydown', onRosterKeydown);

  function openNationPicker(): void {
    if (pickerOpen || !nationPicker) return;
    renderRoster(selectedCountryId);
    pickerOpen = true;
    nationPicker.hidden = false;
    document.getElementById('ifm-campaign')?.setAttribute('inert', '');
    playCue('dossier-open');
    (roster?.querySelector<HTMLButtonElement>('.ifm__country.is-selected')
      ?? roster?.querySelector<HTMLButtonElement>('.ifm__country:not(.is-unavailable)')
      ?? roster)?.focus();
  }

  function closeNationPicker(): void {
    if (!pickerOpen || !nationPicker) return;
    pickerOpen = false;
    nationPicker.hidden = true;
    document.getElementById('ifm-campaign')?.removeAttribute('inert');
    playCue('dossier-close');
    beginOperation?.focus();
  }

  beginOperation?.addEventListener('click', () => openNationPicker());
  nationCancel?.addEventListener('click', () => closeNationPicker());
  confirmNation?.addEventListener('click', () => {
    if (selectedCountryId === null) return;
    void deployFromPicker(selectedCountryId);
  });

  // Graphics quality selector. Reads/persists the choice locally and only
  // notifies handlers - it never initializes the world renderer from the lobby.
  const graphicsGroup = document.getElementById('ifm-graphics-quality');
  const graphicsBlurb = document.getElementById('ifm-graphics-blurb');
  if (graphicsGroup) {
    const buttons = [...graphicsGroup.querySelectorAll<HTMLButtonElement>('[data-graphics-quality]')];
    const paint = (level: QualityLevel): void => {
      for (const button of buttons) {
        const active = button.dataset.graphicsQuality === level;
        button.setAttribute('aria-pressed', String(active));
        button.classList.toggle('is-selected', active);
      }
      if (graphicsBlurb) graphicsBlurb.textContent = QUALITY_PRESETS[level].blurb;
    };
    paint(loadQuality());
    for (const button of buttons) {
      button.addEventListener('click', () => {
        const level = button.dataset.graphicsQuality;
        if (!isQualityLevel(level)) return;
        saveQuality(level);
        paint(level);
        handlers.onGraphicsQuality?.(level);
      });
    }
  }

  async function launch(countryId: number): Promise<void> {
    playCue('confirm');
    root.style.transition = 'opacity .5s ease';
    root.style.opacity = '0';
    await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
    try {
      root.hidden = true;
      if (brand) brand.hidden = false;
      await handlers.onLaunch(countryId);
    } catch (error) {
      // The launch was abandoned (e.g. "Return to Command"). Bring the menu
      // back on its primary screen with interaction fully restored.
      resetToMainScreen();
      root.hidden = false;
      root.style.opacity = '1';
      if (brand) brand.hidden = true;
      throw error;
    }
  }

  async function deploy(countryId: number): Promise<void> {
    if (busy) return; // don't launch while a menu transition is still animating
    try {
      await launch(countryId);
    } catch (error) {
      if (countryHint) countryHint.textContent = error instanceof Error ? error.message : 'Unable to deploy.';
    }
  }

  /**
   * New Campaign's nation-picker entry point (Confirm button + roster Enter).
   * While a campaign is already loaded this is preview-only: it never launches,
   * so the New Campaign flow can be inspected without risking data/game.json.
   * Continue does NOT go through here — it calls `deploy` directly.
   */
  async function deployFromPicker(countryId: number): Promise<void> {
    if (previewOnly) {
      if (countryHint) {
        countryHint.textContent = `Preview only — a second campaign slot isn't built yet. `
          + `Your campaign${assignedCountry ? ` as ${assignedCountry.name}` : ''} is untouched; use Continue to resume it.`;
      }
      playCue('select');
      return;
    }
    await deploy(countryId);
  }

  document.getElementById('ifm-apply-settings')?.addEventListener('click', () => playCue('confirm'));
}

function requiredId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing menu element: #${id}`);
  return el as unknown as T;
}
