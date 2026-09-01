import { describe, expect, it } from 'vitest';
import type { MusicPlaybackOptions } from '../src/audio/audio-manager';
import { MusicDirector, type MusicPlayer } from '../src/audio/music-director';

class FakeMusicPlayer implements MusicPlayer {
  readonly calls: Array<{ url: string; options?: MusicPlaybackOptions }> = [];
  readonly failedFragments = new Set<string>();
  stops = 0;

  async playMusic(url: string, options?: MusicPlaybackOptions): Promise<boolean> {
    this.calls.push({ url, options });
    return ![...this.failedFragments].some((fragment) => url.includes(fragment));
  }

  stopMusic(): void {
    this.stops += 1;
  }

  endCurrent(): void {
    this.calls.at(-1)?.options?.onEnded?.();
  }
}

describe('music director', () => {
  it('starts the main menu with Honor Bound', async () => {
    const player = new FakeMusicPlayer();
    const director = new MusicDirector(player, { random: () => 0 });

    await director.setState('menu');

    expect(director.getState()).toBe('menu');
    expect(player.calls).toHaveLength(1);
    expect(player.calls[0].url).toContain('Honor_Bound.ogg');
  });


  it('fires onTrackChange only after playback actually succeeds, and with null on stop', async () => {
    const player = new FakeMusicPlayer();
    player.failedFragments.add('Honor_Bound.ogg');
    player.failedFragments.add('Honor_Bound.mp3');
    const changes: Array<string | null> = [];
    const director = new MusicDirector(player, {
      random: () => 0,
      onTrackChange: (track) => changes.push(track ? track.title : null),
    });

    await director.setState('menu'); // blocked autoplay — no title must appear
    expect(changes).toEqual([]);
    expect(director.getCurrentTrack()).toBeNull();

    player.failedFragments.clear();
    await director.setState('menu', { force: true });
    expect(changes).toEqual(['Honor Bound']);
    expect(director.getCurrentTrack()?.title).toBe('Honor Bound');

    director.stop();
    expect(changes).toEqual(['Honor Bound', null]);
    expect(director.getCurrentTrack()).toBeNull();
  });

  it('retries the same first menu track when autoplay was blocked', async () => {
    const player = new FakeMusicPlayer();
    player.failedFragments.add('Honor_Bound.ogg');
    player.failedFragments.add('Honor_Bound.mp3');
    const director = new MusicDirector(player, { random: () => 0 });

    await director.setState('menu');
    player.failedFragments.clear();
    await director.setState('menu', { force: true });

    expect(player.calls.at(-1)?.url).toContain('Honor_Bound.ogg');
  });

  it('falls back gracefully when First Sighting has not been vendored yet', async () => {
    const player = new FakeMusicPlayer();
    player.failedFragments.add('First_Sighting.mp3');
    const director = new MusicDirector(player, { random: () => 0 });

    await director.setState('opening');

    expect(player.calls.map((call) => call.url)).toEqual([
      '/audio/music/First_Sighting.mp3',
      expect.stringContaining('Land_between_the_two_Seas.ogg'),
    ]);
    expect(director.getState()).toBe('opening');
  });

  it('skips an unavailable Elusive Predator and continues the war pool', async () => {
    const player = new FakeMusicPlayer();
    player.failedFragments.add('Elusive_Predator.mp3');
    const director = new MusicDirector(player, { random: () => 0 });

    await director.setState('war');

    expect(player.calls[0].url).toBe('/audio/music/Elusive_Predator.mp3');
    expect(player.calls[1].url).toContain('Helen_Leaves_Sparta.ogg');
    expect(director.getState()).toBe('war');
  });

  it('moves from the opening cue into the peace rotation when the cue ends', async () => {
    const player = new FakeMusicPlayer();
    player.failedFragments.add('First_Sighting.mp3');
    const director = new MusicDirector(player, { random: () => 0 });

    await director.setState('opening');
    player.endCurrent();
    await Promise.resolve();
    await Promise.resolve();

    expect(director.getState()).toBe('peace');
    expect(player.calls.at(-1)?.url).toContain('Ammon-Ra.ogg');
  });

  it('plays every war track once before starting another cycle', async () => {
    const player = new FakeMusicPlayer();
    const director = new MusicDirector(player, { random: () => 0 });

    await director.setState('war');
    await director.setState('war', { force: true });
    await director.setState('war', { force: true });
    await director.setState('war', { force: true });

    expect(player.calls.map((call) => call.url)).toEqual([
      '/audio/music/Elusive_Predator.mp3',
      expect.stringContaining('Helen_Leaves_Sparta.ogg'),
      expect.stringContaining('Karmic_Confluence.ogg'),
      expect.stringContaining('Rise_of_Macedon.ogg'),
    ]);

    await director.setState('war', { force: true });
    expect(player.calls.at(-1)?.url).not.toContain('Rise_of_Macedon.ogg');
  });

  it('stops and invalidates the current soundtrack state', async () => {
    const player = new FakeMusicPlayer();
    const director = new MusicDirector(player);

    await director.setState('menu');
    director.stop();

    expect(director.getState()).toBeNull();
    expect(player.stops).toBe(1);
  });

  it('resyncPlayback replays the CURRENT state after a blocked attempt, not menu', async () => {
    const player = new FakeMusicPlayer();
    player.failedFragments.add('First_Sighting');
    player.failedFragments.add('Land_between_the_two_Seas');
    const director = new MusicDirector(player, { random: () => 0 });

    await director.setState('opening');
    expect(director.getState()).toBe('opening');

    player.failedFragments.clear();
    player.calls.length = 0;
    await director.resyncPlayback();

    expect(player.calls.length).toBeGreaterThan(0);
    expect(player.calls[0].url).toContain('First_Sighting');
    expect(player.calls.some((call) => call.url.toLowerCase().includes('honor_bound'))).toBe(false);
  });

  it('resyncPlayback is a no-op when no musical state is active', async () => {
    const player = new FakeMusicPlayer();
    const director = new MusicDirector(player, { random: () => 0 });

    await director.resyncPlayback();

    expect(player.calls).toHaveLength(0);
    expect(director.getState()).toBeNull();
  });
});
