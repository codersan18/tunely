import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readTags } from '../utils/readTags';
import { localCover } from '../utils/localCover';
import * as source from '../utils/localSource';

// Songs already saved on the phone (Music, Download, WhatsApp audio…), found through Android's
// media library, or on the web the songs in a music folder on the computer (utils/localSource*.js).
// They play straight from their file: nothing is copied or uploaded.
// Only the song details read from each file's tags are remembered, so the list opens fast.

export const LOCAL_SUPPORTED = source.LOCAL_SUPPORTED;
export const PLACE = source.PLACE; // "On this phone" / "On this computer" and its wording
const TAGS_KEY = 'tunely:localTags:v1'; // { [file id]: { m: modificationTime, title, artist, album } }
const RESCAN_MS = 30000; // coming back to the app looks for new songs, at most this often
const LocalMusicContext = createContext(null);

// "Artist - Title.mp3" -> { artist, title }; otherwise the file name is the title.
function fromFilename(filename) {
  const base = (filename || 'Unknown song').replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const m = base.match(/^(.+?)\s+-\s+(.+)$/);
  return m ? { artist: m[1], title: m[2] } : { artist: '', title: base };
}

// Where the file lives decides its section: WhatsApp audio, Others (recordings, calls, Telegram,
// podcasts…) or Songs (Music, Download and everything else).
const OTHER_FOLDERS = /(^|\/)(recordings?|call[ _-]?(recordings?|rec)?|calls|voice[ _-]?(notes|recorder|recordings?)|sound[ _-]?recorder|recorder|record|notifications|ringtones|alarms|podcasts|audiobooks|telegram[^/]*|signal|snapchat|instagram)(\/|$)/i;
export const CATEGORIES = [
  { key: 'songs', title: 'Songs', icon: 'musical-notes' },
  { key: 'whatsapp', title: 'WhatsApp audio', icon: 'logo-whatsapp' },
  { key: 'others', title: 'Others', icon: 'folder-open' },
];

function placeOf(where) {
  let path = where.replace(/^file:\/\//, '');
  try { path = decodeURIComponent(path); } catch (e) { /* keep as is */ }
  const parts = path.split('/').filter(Boolean);
  let folder = parts.length > 1 ? parts[parts.length - 2] : 'Phone';
  // WhatsApp voice notes sit in dated folders ("202611"): name them after the folder above.
  if (/^\d+$/.test(folder) && parts.length > 2) folder = parts[parts.length - 3];
  const category = /\/whatsapp( business)?\//i.test(path) ? 'whatsapp' : OTHER_FOLDERS.test(path) ? 'others' : 'songs';
  return { folder, category };
}

const toTrack = (f, tags) => {
  const guess = fromFilename(f.filename);
  return {
    ...placeOf(f.path),
    id: `local:${f.id}`,
    title: tags?.title || guess.title,
    artist: tags?.artist || guess.artist || 'Unknown artist',
    album: tags?.album || '',
    url: f.uri,
    artwork: localCover(f.uri), // read from the file when shown (utils/localCover.js)
    duration: f.duration,
    local: true,
  };
};

// Run `fn` over `items`, a few at a time.
async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

export function LocalMusicProvider({ children }) {
  // unsupported | checking | needs-permission | denied | loading | ready
  const [status, setStatus] = useState(LOCAL_SUPPORTED ? 'checking' : 'unsupported');
  const [tracks, setTracks] = useState([]);
  const statusRef = useRef(status); statusRef.current = status;
  const scanning = useRef(false);
  const lastScan = useRef(0);

  const scan = useCallback(async ({ force = false } = {}) => {
    if (!LOCAL_SUPPORTED || scanning.current) return;
    if (!force && Date.now() - lastScan.current < RESCAN_MS) return;
    scanning.current = true;
    lastScan.current = Date.now();
    try {
      const files = await source.listFiles();
      let cache = {};
      try { cache = JSON.parse((await AsyncStorage.getItem(TAGS_KEY)) || '{}'); } catch (e) { /* start fresh */ }
      const known = (f) => cache[f.id]?.m === f.modified && cache[f.id];

      // 1. Show the list straight away, with details remembered from last time or from file names.
      setTracks(files.map((f) => toTrack(f, known(f))));
      setStatus('ready');

      // 2. Read the tags of new or changed files, in the background.
      const next = {};
      const todo = [];
      files.forEach((f) => {
        const hit = known(f);
        if (hit) next[f.id] = hit; else todo.push(f);
      });
      if (todo.length) {
        await inBatches(todo, 4, async (f) => {
          let tags = null;
          try { tags = await readTags(f.uri, { cover: false }); } catch (err) { /* no tags, or unreadable */ }
          next[f.id] = { m: f.modified, title: tags?.title || '', artist: tags?.artist || '', album: tags?.album || '' };
        });
        setTracks(files.map((f) => toTrack(f, next[f.id])));
      }
      AsyncStorage.setItem(TAGS_KEY, JSON.stringify(next)).catch(() => {});
    } catch (e) {
      console.warn('Could not read the songs', e);
      setStatus((s) => (s === 'loading' ? 'ready' : s));
    } finally {
      scanning.current = false;
    }
  }, []);

  // Already allowed? Then list the songs. Otherwise wait until the person asks for them.
  const check = useCallback(async () => {
    if (!LOCAL_SUPPORTED) return;
    try {
      const access = await source.checkAccess();
      if (access === 'granted') {
        const listed = statusRef.current === 'ready';
        if (!listed) setStatus('loading');
        scan({ force: !listed }); // just allowed (e.g. in Settings): list now
      } else {
        setStatus(access);
      }
    } catch (e) {
      setStatus('needs-permission');
    }
  }, [scan]);

  useEffect(() => { check(); }, [check]);

  // Coming back to the app (maybe after downloading songs, or allowing access in Settings): look again.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') check(); });
    return () => sub.remove();
  }, [check]);

  const afterAccess = useCallback((access) => {
    if (access === 'granted') {
      setStatus('loading');
      scan({ force: true });
    } else {
      setStatus(access);
    }
  }, [scan]);

  const requestAccess = useCallback(async () => {
    try { afterAccess(await source.requestAccess(status)); } catch (e) { /* stay as is */ }
  }, [status, afterAccess]);

  // Web: pick a different music folder.
  const changeFolder = useMemo(() => (source.changeFolder
    ? async () => { try { afterAccess(await source.changeFolder()); } catch (e) { /* cancelled */ } }
    : null), [afterAccess]);

  const rescan = useCallback(() => scan({ force: true }), [scan]);

  // Sections and groups for the "On this phone" screen.
  const groups = useMemo(() => {
    const byCategory = { songs: [], whatsapp: [], others: [] };
    const artists = new Map();
    const albums = new Map();
    const folders = new Map();
    const add = (map, name, t, extra) => {
      const g = map.get(name.toLowerCase()) || { name, count: 0, artwork: t.artwork, ...extra };
      g.count += 1;
      map.set(name.toLowerCase(), g);
    };
    for (const t of tracks) {
      byCategory[t.category].push(t);
      if (t.category === 'songs') {
        t.artist.split(/\s*,\s*/).filter(Boolean).forEach((a) => add(artists, a, t));
        if (t.album) add(albums, t.album, t, { artist: t.artist });
      }
      add(folders, t.folder, t);
    }
    const sorted = (m) => [...m.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return { byCategory, artists: sorted(artists), albums: sorted(albums), folders: sorted(folders) };
  }, [tracks]);

  const value = useMemo(() => ({ status, tracks, groups, requestAccess, rescan, changeFolder }),
    [status, tracks, groups, requestAccess, rescan, changeFolder]);
  return <LocalMusicContext.Provider value={value}>{children}</LocalMusicContext.Provider>;
}

export function useLocalMusic() {
  const ctx = useContext(LocalMusicContext);
  if (!ctx) throw new Error('useLocalMusic must be used inside <LocalMusicProvider>');
  return ctx;
}
