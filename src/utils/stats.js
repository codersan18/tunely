// "Your VibeRoom": what this listener played. This device's own counts are kept here and sent to
// the account (components/LibrarySync.js); the other devices' counts come back as `remote` and are
// added in when the stats are shown.
// Grouped by month so it stays small however long the app is used:
//   months: { 'YYYY-MM': { s: seconds, n: plays, songs: { [id]: [plays, seconds] } } }
//   meta:   { [id]: { t: title, a: artist, w: artwork, l: local } }   (latest details of each song)

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'tunely:stats:v1';
const REMOTE_KEY = 'tunely:stats:remote:v1';
let data = null;
let remote = { months: {}, meta: {} };
let loading = null;
let saveTimer = null;
const listeners = new Set();

const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function load() {
  if (data) return Promise.resolve(data);
  if (!loading) {
    loading = AsyncStorage.multiGet([KEY, REMOTE_KEY])
      .then(([[, raw], [, rawRemote]]) => {
        data = raw ? JSON.parse(raw) : { months: {}, meta: {} };
        if (rawRemote) remote = JSON.parse(rawRemote);
      })
      .catch(() => { data = data || { months: {}, meta: {} }; })
      .then(() => data);
  }
  return loading;
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => {}); }, 3000);
  listeners.forEach((fn) => fn());
}

// Add listening time for a song; `play` counts it as one play (after 30 s or half the song).
export async function addListen(track, seconds, play = false) {
  if (!track?.id || (seconds <= 0 && !play)) return;
  await load();
  const m = (data.months[monthKey()] ||= { s: 0, n: 0, songs: {} });
  const row = (m.songs[track.id] ||= [0, 0]);
  row[1] += Math.round(seconds);
  m.s += Math.round(seconds);
  if (play) { row[0] += 1; m.n += 1; }
  data.meta[track.id] = { t: track.title, a: track.artist, w: track.artwork || null, l: !!track.local };
  save();
}

/** This device's own counts, for syncing. */
export async function exportStats() {
  await load();
  return { months: data.months, meta: data.meta };
}

/** The account's other devices' counts, added together (from the sync). */
export async function setRemoteStats(others) {
  await load();
  remote = { months: others?.months || {}, meta: others?.meta || {} };
  AsyncStorage.setItem(REMOTE_KEY, JSON.stringify(remote)).catch(() => {});
  listeners.forEach((fn) => fn());
}

/** Forget everything (signing out). */
export async function clearStats() {
  clearTimeout(saveTimer);
  data = { months: {}, meta: {} };
  remote = { months: {}, meta: {} };
  loading = Promise.resolve(data);
  await AsyncStorage.multiRemove([KEY, REMOTE_KEY]).catch(() => {});
  listeners.forEach((fn) => fn());
}

export function onStatsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// period: 'month' | 'year' | 'all'
export async function getStats(period) {
  await load();
  const now = new Date();
  const wanted = (k) => (
    period === 'all' ? true
      : period === 'year' ? k.startsWith(`${now.getFullYear()}-`)
        : k === monthKey(now)
  );
  const songs = new Map();
  let seconds = 0;
  let plays = 0;
  for (const source of [data, remote]) { // this device + the account's other devices
    for (const [k, m] of Object.entries(source.months || {})) {
      if (!wanted(k)) continue;
      seconds += m.s || 0;
      plays += m.n || 0;
      for (const [id, [p, s]] of Object.entries(m.songs || {})) {
        const row = songs.get(id) || { plays: 0, seconds: 0 };
        row.plays += p;
        row.seconds += s;
        songs.set(id, row);
      }
    }
  }
  const meta = { ...remote.meta, ...data.meta };
  const toTrack = (id) => {
    const m = meta[id] || {};
    return { id, title: m.t || 'Unknown song', artist: m.a || 'Unknown artist', artwork: m.w || null, local: !!m.l };
  };
  const topSongs = [...songs.entries()]
    .filter(([, r]) => r.plays > 0)
    .sort((a, b) => b[1].plays - a[1].plays || b[1].seconds - a[1].seconds)
    .slice(0, 10)
    .map(([id, r]) => ({ track: toTrack(id), ...r }));
  const artists = new Map();
  for (const [id, r] of songs) {
    for (const name of (meta[id]?.a || 'Unknown artist').split(/\s*,\s*/)) {
      const a = artists.get(name) || { name, plays: 0, seconds: 0 };
      a.plays += r.plays;
      a.seconds += r.seconds;
      artists.set(name, a);
    }
  }
  const topArtists = [...artists.values()].filter((a) => a.plays > 0)
    .sort((a, b) => b.plays - a.plays || b.seconds - a.seconds).slice(0, 5);
  return { seconds, plays, songCount: [...songs.values()].filter((r) => r.plays > 0).length, topSongs, topArtists };
}
