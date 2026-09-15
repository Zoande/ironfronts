export type MusicState = 'menu' | 'opening' | 'peace' | 'war';

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  state: MusicState;
  durationSeconds: number;
  archiveFile: string;
  officialFile?: string;
}

const OFFICIAL_0AD_COMMIT = '61a3b9507d974084e6badb88a0826bd89a6d5b8b';
const OFFICIAL_0AD_MUSIC_ROOT =
  `https://raw.githubusercontent.com/0ad/0ad/${OFFICIAL_0AD_COMMIT}/binaries/data/mods/public/audio/music`;

function track(
  id: string,
  title: string,
  state: MusicState,
  durationSeconds: number,
  archiveFile: string,
  officialFile?: string,
  artist = 'Omri Lahav',
): MusicTrack {
  return { id, title, artist, state, durationSeconds, archiveFile, officialFile };
}

/**
 * The 31 tracks from the official May 2015 0 A.D. MP3 soundtrack archive.
 *
 * Ironfronts uses the user's requested gameplay grouping. In particular,
 * Dried Tears is deliberately in the relaxed pool here even though 0 A.D.
 * historically used it as a defeat cue.
 */
export const MUSIC_TRACKS: readonly MusicTrack[] = [
  track('calm-before-the-storm', 'Calm Before the Storm', 'menu', 142.73, 'Calm_Before_the_Storm.mp3', 'Calm_Before_the_Storm.ogg'),
  track('honor-bound', 'Honor Bound', 'menu', 166.06, 'Honor_Bound.mp3', 'Honor_Bound.ogg'),

  track('first-sighting', 'First Sighting', 'opening', 102.50, 'First_Sighting.mp3', undefined, 'Jeff Willet'),

  track('ammon-ra', 'Ammon-Ra', 'peace', 157.05, 'Ammon-Ra.mp3', 'Ammon-Ra.ogg'),
  track('old-warhorse', 'An Old Warhorse Goes to Pasture', 'peace', 203.05, 'An_old_Warhorse_goes_to_Pasture.mp3', 'An_old_Warhorse_goes_to_Pasture.ogg'),
  track('celtic-pride', 'Celtic Pride', 'peace', 195.40, 'Celtic_Pride.mp3', 'Celtic_Pride.ogg'),
  track('celtica', 'Celtica', 'peace', 180.92, 'Celtica.mp3', 'Celtica.ogg'),
  track('cisalpine-gaul', 'Cisalpine Gaul', 'peace', 173.91, 'Cisalpine_Gaul.mp3', 'Cisalpine_Gaul.ogg'),
  track('dried-tears', 'Dried Tears', 'peace', 83.70, 'Dried_Tears.mp3', 'Dried_Tears.ogg'),
  track('eastern-dreams', 'Eastern Dreams', 'peace', 229.04, 'Eastern_Dreams.mp3', 'Eastern_Dreams.ogg'),
  track('elysian-fields', 'Elysian Fields', 'peace', 322.09, 'Elysian_Fields.mp3', 'Elysian_Fields.ogg'),
  track('forging-city-state', 'Forging a City-State', 'peace', 211.38, 'Forging_a_City-State.mp3', 'Forging_a_City-State.ogg'),
  track('harsh-lands', 'Harsh Lands, Rugged People', 'peace', 153.55, 'Harsh_Lands_Rugged_People.mp3', 'Harsh_Lands_Rugged_People.ogg'),
  track('harvest-festival', 'Harvest Festival', 'peace', 221.39, 'Harvest Festival.mp3', 'Harvest_Festival.ogg'),
  track('highland-mist', 'Highland Mist', 'peace', 236.54, 'Highland_Mist.mp3', 'Highland_Mist.ogg'),
  track('in-shadow-olympus', 'In the Shadow of Olympus', 'peace', 245.03, 'In_the_Shadow_of_Olympus.mp3', 'In_the_Shadow_of_Olympus.ogg'),
  track('juno-protect-you', 'Juno Protect You', 'peace', 249.91, 'Juno_Protect_You.mp3', 'Juno_Protect_You.ogg'),
  track('land-two-seas', 'Land Between the Two Seas', 'peace', 131.03, 'Land_between_the_two_Seas.mp3', 'Land_between_the_two_Seas.ogg'),
  track('mediterranean-waves', 'Mediterranean Waves', 'peace', 267.44, 'Mediterranean_Waves.mp3', 'Mediterranean_Waves.ogg'),
  track('peaks-atlas', 'Peaks of Atlas', 'peace', 178.83, 'Peaks_of_Atlas.mp3', 'Peaks_of_Atlas.ogg'),
  track('sands-time', 'Sands of Time', 'peace', 252.03, 'Sands_of_Time.mp3', 'Sands_of_Time.ogg'),
  track('tavern-mist', 'Tavern in the Mist', 'peace', 157.01, 'Tavern_in_the_Mist.mp3', 'Tavern_in_the_Mist.ogg', 'Mike Skalandunas'),
  track('hellespont', 'The Hellespont', 'peace', 128.08, 'The_Hellespont.mp3', 'The_Hellespont.ogg'),
  track('road-ahead', 'The Road Ahead', 'peace', 305.45, 'The_Road_Ahead.mp3', 'The_Road_Ahead.ogg'),
  track('valley-nile', 'Valley of the Nile', 'peace', 116.04, 'Valley_of_the_Nile.mp3', 'Valley_of_the_Nile.ogg', 'Omri Lahav & Shlomi Nogay'),
  track('waters-edge', "Water's Edge", 'peace', 188.97, "Water's_Edge.mp3", "Water's_Edge.ogg"),

  track('elusive-predator', 'Elusive Predator', 'war', 177.16, 'Elusive_Predator.mp3', undefined, 'Jeff Willet'),
  track('helen-leaves-sparta', 'Helen Leaves Sparta', 'war', 259.74, 'Helen Leaves Sparta.mp3', 'Helen_Leaves_Sparta.ogg'),
  track('karmic-confluence', 'Karmic Confluence', 'war', 106.03, 'Karmic Confluence.mp3', 'Karmic_Confluence.ogg'),
  track('rise-macedon', 'Rise of Macedon', 'war', 240.59, 'Rise of Macedon.mp3', 'Rise_of_Macedon.ogg'),

] as const;

export const TRACK_BY_ID = new Map(MUSIC_TRACKS.map((candidate) => [candidate.id, candidate]));

export function tracksForState(state: MusicState): MusicTrack[] {
  return MUSIC_TRACKS.filter((candidate) => candidate.state === state);
}

export function trackSources(candidate: MusicTrack): string[] {
  const sources: string[] = [];
  if (candidate.officialFile) {
    sources.push(`${OFFICIAL_0AD_MUSIC_ROOT}/${encodeURIComponent(candidate.officialFile)}`);
  }
  // Once the MP3 archive is vendored into public/audio/music, this becomes a
  // same-origin fallback and also supplies the two old combat tracks that are
  // no longer present in the archived 0ad/0ad GitHub mirror.
  sources.push(`/audio/music/${encodeURIComponent(candidate.archiveFile)}`);
  return sources;
}

export function chooseTrack(
  pool: readonly MusicTrack[],
  recentIds: readonly string[],
  random: () => number = Math.random,
): MusicTrack | undefined {
  if (!pool.length) return undefined;
  const recent = new Set(recentIds);
  const candidates = pool.filter((candidate) => !recent.has(candidate.id));

  // When every track in a small pool is already in recent history (menu/war),
  // start a new cycle without immediately replaying the track that just ended.
  // A one-track pool is the only case where an immediate repeat is unavoidable.
  const mostRecentId = recentIds[0];
  const cycleFallback = pool.length > 1 && mostRecentId
    ? pool.filter((candidate) => candidate.id !== mostRecentId)
    : [...pool];
  const usable = candidates.length ? candidates : cycleFallback;
  const index = Math.min(usable.length - 1, Math.floor(Math.max(0, Math.min(0.999999, random())) * usable.length));
  return usable[index];
}
