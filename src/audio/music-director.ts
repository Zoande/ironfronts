import type { MusicPlaybackOptions } from './audio-manager';
import {
  TRACK_BY_ID,
  chooseTrack,
  trackSources,
  tracksForState,
  type MusicState,
  type MusicTrack,
} from './music-catalog';

export interface MusicPlayer {
  playMusic(url: string, options?: MusicPlaybackOptions): Promise<boolean>;
  stopMusic(fadeSeconds?: number): void;
}

export interface MusicDirectorOptions {
  random?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  /** Fired only when a track *actually* starts playing (post `playMusic`
   *  success), and with `null` when music stops. Never fired for a blocked
   *  autoplay attempt — so a "Now Playing" readout can't show a phantom title. */
  onTrackChange?: (track: MusicTrack | null) => void;
}

const RECENT_HISTORY = 4;

export class MusicDirector {
  private readonly random: () => number;
  private readonly setTimer: NonNullable<MusicDirectorOptions['setTimer']>;
  private readonly clearTimer: NonNullable<MusicDirectorOptions['clearTimer']>;
  private readonly onTrackChange: NonNullable<MusicDirectorOptions['onTrackChange']>;
  private currentTrackId: string | null = null;
  private state: MusicState | null = null;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private recentIds: string[] = [];
  private readonly playedIdsByState = new Map<MusicState, Set<string>>();
  private menuPlayed = false;

  constructor(
    private readonly player: MusicPlayer,
    options: MusicDirectorOptions = {},
  ) {
    this.random = options.random ?? Math.random;
    this.setTimer = options.setTimer ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));
    this.clearTimer = options.clearTimer ?? ((timer) => globalThis.clearTimeout(timer));
    this.onTrackChange = options.onTrackChange ?? (() => undefined);
  }

  getState(): MusicState | null {
    return this.state;
  }

  /** The track currently playing, or null when music is stopped / blocked. */
  getCurrentTrack(): MusicTrack | null {
    return this.currentTrackId ? TRACK_BY_ID.get(this.currentTrackId) ?? null : null;
  }

  /**
   * Re-attempt playback for the CURRENT logical state after the browser finally
   * allows audio. This keeps logical state and actual playback separate: a
   * blocked autoplay attempt may advance state even though no track started.
   */
  async resyncPlayback(): Promise<void> {
    if (this.state === null) return;
    await this.setState(this.state, { force: true });
  }

  async setState(next: MusicState, options: { force?: boolean } = {}): Promise<void> {
    if (this.state === next && next !== 'victory' && !options.force) return;

    this.state = next;
    this.generation += 1;
    const generation = this.generation;
    this.cancelTimer();

    if (next === 'victory') {
      const victory = TRACK_BY_ID.get('victorious');
      if (victory) await this.playTrack(victory, next, generation, 0.45);
      return;
    }

    if (next === 'opening') {
      const opening = TRACK_BY_ID.get('first-sighting');
      if (opening && await this.playTrack(opening, next, generation, 0.85)) return;

      // The archived GitHub mirror no longer carries this old Jeff Willet
      // track. Until the supplied MP3 archive is vendored, use a short calm
      // fallback instead of leaving the opening silent.
      const fallback = TRACK_BY_ID.get('land-two-seas');
      if (fallback) await this.playTrack(fallback, next, generation, 0.85);
      return;
    }

    if (next === 'menu') {
      if (!this.menuPlayed) {
        const firstMenuTrack = TRACK_BY_ID.get('honor-bound');
        if (firstMenuTrack) {
          const played = await this.playTrack(firstMenuTrack, next, generation, 0.35);
          if (played) this.menuPlayed = true;
        }
        return;
      }

      await this.playNextFromPool(next, generation);
      return;
    }

    await this.playNextFromPool(next, generation);
  }

  stop(fadeSeconds = 0.8): void {
    this.generation += 1;
    this.state = null;
    this.cancelTimer();
    this.player.stopMusic(fadeSeconds);
    if (this.currentTrackId !== null) {
      this.currentTrackId = null;
      this.onTrackChange(null);
    }
  }

  private async playNextFromPool(
    state: Extract<MusicState, 'menu' | 'peace' | 'war'>,
    generation: number,
    attemptedIds: ReadonlySet<string> = new Set(),
  ): Promise<void> {
    if (!this.isCurrent(state, generation)) return;
    const pool = tracksForState(state);
    const remaining = pool.filter((candidate) => !attemptedIds.has(candidate.id));
    const playedThisCycle = this.playedIdsByState.get(state) ?? new Set<string>();
    const unplayed = remaining.filter((candidate) => !playedThisCycle.has(candidate.id));

    // Prefer every track in the current state once before beginning another
    // cycle. This matters most for the small menu/war pools, where a short
    // recent-history window could otherwise repeat songs too often.
    if (!unplayed.length && remaining.length) {
      playedThisCycle.clear();
    }
    this.playedIdsByState.set(state, playedThisCycle);

    const cyclePool = unplayed.length ? unplayed : remaining;
    const candidate = chooseTrack(cyclePool, this.recentIds, this.random);
    if (!candidate) {
      // Do not recurse forever when every source is temporarily unavailable.
      this.scheduleRetry(state, generation);
      return;
    }

    const played = await this.playTrack(candidate, state, generation, state === 'war' ? 0.55 : 1.35);
    if (!played && this.isCurrent(state, generation)) {
      this.remember(candidate.id);
      const attempted = new Set(attemptedIds);
      attempted.add(candidate.id);
      await this.playNextFromPool(state, generation, attempted);
    }
  }

  private async playTrack(
    candidate: MusicTrack,
    state: MusicState,
    generation: number,
    fadeSeconds: number,
  ): Promise<boolean> {
    for (const source of trackSources(candidate)) {
      if (!this.isCurrent(state, generation)) return false;
      const played = await this.player.playMusic(source, {
        fadeSeconds,
        onEnded: () => this.onTrackEnded(state, generation),
      });
      if (played) {
        this.remember(candidate.id);
        this.rememberForState(state, candidate.id);
        if (this.currentTrackId !== candidate.id) {
          this.currentTrackId = candidate.id;
          this.onTrackChange(candidate);
        }
        return true;
      }
    }
    return false;
  }

  private onTrackEnded(state: MusicState, generation: number): void {
    if (!this.isCurrent(state, generation)) return;

    if (state === 'victory') return;
    if (state === 'opening') {
      void this.setState('peace');
      return;
    }

    const minimumSeconds = state === 'war' ? 2 : state === 'menu' ? 5 : 8;
    const maximumSeconds = state === 'war' ? 6 : state === 'menu' ? 11 : 20;
    const delaySeconds = minimumSeconds + this.random() * (maximumSeconds - minimumSeconds);

    this.cancelTimer();
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      if (!this.isCurrent(state, generation)) return;
      void this.playNextFromPool(state, generation);
    }, Math.round(delaySeconds * 1000));
  }

  private scheduleRetry(state: Extract<MusicState, 'menu' | 'peace' | 'war'>, generation: number): void {
    this.cancelTimer();
    const delaySeconds = 15 + this.random() * 15;
    this.timer = this.setTimer(() => {
      this.timer = undefined;
      if (!this.isCurrent(state, generation)) return;
      void this.playNextFromPool(state, generation);
    }, Math.round(delaySeconds * 1000));
  }

  private remember(id: string): void {
    this.recentIds = [id, ...this.recentIds.filter((candidate) => candidate !== id)].slice(0, RECENT_HISTORY);
  }

  private rememberForState(state: MusicState, id: string): void {
    const played = this.playedIdsByState.get(state) ?? new Set<string>();
    played.add(id);
    this.playedIdsByState.set(state, played);
  }

  private cancelTimer(): void {
    if (this.timer === undefined) return;
    this.clearTimer(this.timer);
    this.timer = undefined;
  }

  private isCurrent(state: MusicState, generation: number): boolean {
    return this.state === state && this.generation === generation;
  }
}
