// Smart shuffle: after each song, pick the library song that sounds most like it.
// "Sounds like" comes from the tags the admin sets: language and mood matter most,
// then genre, artist and album. A little randomness keeps it from repeating the same order.

export const LANGUAGES = ['Tamil', 'Telugu', 'Malayalam', 'Kannada', 'Hindi', 'English', 'Instrumental'];
export const MOODS = ['Melody', 'Love', 'Sad', 'Kuthu', 'Dance', 'Party', 'Chill', 'Devotional', 'Folk', 'Workout'];

const norm = (s) => (s || '').trim().toLowerCase();

const WEIGHTS = {
  language: 5, // a Tamil song should be followed by a Tamil song
  mood: 4,     // ...and a melody by a melody
  genre: 2,
  artist: 1.5,
  album: 1,
  inContext: 1, // already in the playlist / album the user started from
};

// Higher = more similar. Only compares fields both songs actually have.
export function similarity(a, b) {
  let score = 0;
  const same = (field) => norm(a[field]) && norm(a[field]) === norm(b[field]);
  if (same('language')) score += WEIGHTS.language;
  else if (norm(a.language) && norm(b.language)) score -= WEIGHTS.language; // different language: push it down
  if (same('mood')) score += WEIGHTS.mood;
  if (same('genre')) score += WEIGHTS.genre;
  if (same('artist') && norm(a.artist) !== 'unknown artist') score += WEIGHTS.artist;
  if (same('album')) score += WEIGHTS.album;
  return score;
}

/**
 * Choose the next song.
 * - current: the song playing now
 * - candidates: songs that can be played right now (all songs online, downloads only when offline)
 * - avoid: song ids to skip (played recently or skipped)
 * - context: ids of the list the user started from, preferred a little
 * Returns a song or null.
 */
export function pickSimilar(current, candidates, { avoid = new Set(), context = new Set(), random = Math.random } = {}) {
  if (!current) return null;
  const pool = candidates.filter((t) => t.id !== current.id);
  if (!pool.length) return null;

  // If everything has been played, allow repeats rather than stopping the music.
  const fresh = pool.filter((t) => !avoid.has(t.id));
  const list = fresh.length ? fresh : pool;

  let best = null;
  let bestScore = -Infinity;
  for (const t of list) {
    const s = similarity(current, t) + (context.has(t.id) ? WEIGHTS.inContext : 0) + random() * 1.5;
    if (s > bestScore) { best = t; bestScore = s; }
  }
  return best;
}

// Short label for why a song was picked, e.g. "Tamil · Melody".
export function vibeLabel(t) {
  return [t?.language, t?.mood].filter(Boolean).join(' · ');
}
