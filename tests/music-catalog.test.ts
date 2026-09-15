import { describe, expect, it } from 'vitest';
import {
  MUSIC_TRACKS,
  TRACK_BY_ID,
  chooseTrack,
  trackSources,
  tracksForState,
} from '../src/audio/music-catalog';

describe('music catalog', () => {
  it('contains the 30 tracks used by the runtime soundtrack', () => {
    expect(MUSIC_TRACKS).toHaveLength(30);
    expect(new Set(MUSIC_TRACKS.map((track) => track.id)).size).toBe(30);
    expect(new Set(MUSIC_TRACKS.map((track) => track.archiveFile)).size).toBe(30);
  });

  it('matches the Ironfronts soundtrack state grouping', () => {
    expect(tracksForState('menu')).toHaveLength(2);
    expect(tracksForState('opening')).toHaveLength(1);
    expect(tracksForState('peace')).toHaveLength(23);
    expect(tracksForState('war')).toHaveLength(4);
  });

  it('uses the supplied old MP3 archive for the two combat tracks missing from the archived GitHub mirror', () => {
    expect(TRACK_BY_ID.get('first-sighting')?.officialFile).toBeUndefined();
    expect(TRACK_BY_ID.get('elusive-predator')?.officialFile).toBeUndefined();
    expect(trackSources(TRACK_BY_ID.get('first-sighting')!)).toEqual(['/audio/music/First_Sighting.mp3']);
    expect(trackSources(TRACK_BY_ID.get('elusive-predator')!)).toEqual(['/audio/music/Elusive_Predator.mp3']);
  });

  it('pins mirrored soundtrack sources to the archived 0ad commit', () => {
    const honorBound = TRACK_BY_ID.get('honor-bound');
    expect(honorBound).toBeDefined();
    expect(trackSources(honorBound!)[0]).toContain(
      '61a3b9507d974084e6badb88a0826bd89a6d5b8b/binaries/data/mods/public/audio/music/Honor_Bound.ogg',
    );
  });

  it('avoids recently played tracks whenever another candidate is available', () => {
    const pool = tracksForState('menu');
    const selected = chooseTrack(pool, ['honor-bound'], () => 0);
    expect(selected?.id).toBe('calm-before-the-storm');
  });

  it('never immediately repeats the last track when a small pool starts a new cycle', () => {
    const pool = tracksForState('menu');
    const selected = chooseTrack(pool, ['honor-bound', 'calm-before-the-storm'], () => 0);
    expect(selected?.id).toBe('calm-before-the-storm');
  });
});
