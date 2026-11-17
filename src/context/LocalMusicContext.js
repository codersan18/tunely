import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Asset, AssetField, MediaType, Query, getPermissionsAsync, requestPermissionsAsync,
} from 'expo-media-library';
import { readTags } from '../utils/readTags';

// Songs already saved on the phone (Music, Download, WhatsApp audio…), found through Android's
// media library. They play straight from their file: nothing is copied or uploaded.
// Only the song details read from each file's tags are remembered, so the list opens fast.

export const LOCAL_SUPPORTED = Platform.OS === 'android';
const TAGS_KEY = 'tunely:localTags:v1'; // { [assetId]: { m: modificationTime, title, artist, album } }
const PAGE = 200;
const MIN_SECONDS = 30; // shorter files are ringtones, notification sounds and voice notes
const RESCAN_MS = 30000; // coming back to the app looks for new songs, at most this often
const LocalMusicContext = createContext(null);

// Android gives milliseconds (the docs say seconds): no song is 10 hours long, so tell them apart.
const toSeconds = (d) => (!d ? 0 : d > 36000 ? d / 1000 : d);

// "Artist - Title.mp3" -> { artist, title }; otherwise the file name is the title.
function fromFilename(filename) {
  const base = (filename || 'Unknown song').replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
  const m = base.match(/^(.+?)\s+-\s+(.+)$/);
  return m ? { artist: m[1], title: m[2] } : { artist: '', title: base };
}

const toTrack = (meta, uri, tags) => {
  const guess = fromFilename(meta.filename);
  return {
    id: `local:${meta.id}`,
    title: tags?.title || guess.title,
    artist: tags?.artist || guess.artist || 'Unknown artist',
    album: tags?.album || '',
    url: uri,
    artwork: null,
    duration: toSeconds(meta.duration),
    local: true,
  };
};

async function listAudio() {
  const all = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await new Query()
      .eq(AssetField.MEDIA_TYPE, MediaType.AUDIO)
      .orderBy({ key: AssetField.MODIFICATION_TIME, ascending: false })
      .limit(PAGE)
      .offset(offset)
      .exeForMetadata();
    all.push(...page);
    if (page.length < PAGE) break;
  }
  return all.filter((m) => toSeconds(m.duration) >= MIN_SECONDS);
}

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
      const metas = await listAudio();
      let cache = {};
      try { cache = JSON.parse((await AsyncStorage.getItem(TAGS_KEY)) || '{}'); } catch (e) { /* start fresh */ }
      const known = (m) => cache[m.id]?.m === m.modificationTime && cache[m.id];

      // 1. Show the list straight away, with details remembered from last time or from file names.
      const entries = (await inBatches(metas, 25, async (m) => {
        try { return { meta: m, uri: await new Asset(m.id).getUri() }; } catch (e) { return null; }
      })).filter(Boolean);
      setTracks(entries.map((e) => toTrack(e.meta, e.uri, known(e.meta))));
      setStatus('ready');

      // 2. Read the tags of new or changed files, in the background.
      const next = {};
      const todo = [];
      entries.forEach((e) => {
        const hit = known(e.meta);
        if (hit) next[e.meta.id] = hit; else todo.push(e);
      });
      if (todo.length) {
        await inBatches(todo, 4, async (e) => {
          let tags = null;
          try { tags = await readTags(e.uri, { cover: false }); } catch (err) { /* not an MP3, or unreadable */ }
          next[e.meta.id] = { m: e.meta.modificationTime, title: tags?.title || '', artist: tags?.artist || '', album: tags?.album || '' };
        });
        setTracks(entries.map((e) => toTrack(e.meta, e.uri, next[e.meta.id])));
      }
      AsyncStorage.setItem(TAGS_KEY, JSON.stringify(next)).catch(() => {});
    } catch (e) {
      console.warn('Could not read songs on the phone', e);
      setStatus((s) => (s === 'loading' ? 'ready' : s));
    } finally {
      scanning.current = false;
    }
  }, []);

  // Already allowed? Then list the songs. Otherwise wait until the person asks for them.
  const check = useCallback(async () => {
    if (!LOCAL_SUPPORTED) return;
    try {
      const p = await getPermissionsAsync(false, ['audio']);
      if (p.granted) {
        const listed = statusRef.current === 'ready';
        if (!listed) setStatus('loading');
        scan({ force: !listed }); // just allowed (e.g. in Settings): list now
      } else {
        setStatus(p.canAskAgain ? 'needs-permission' : 'denied');
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

  const requestAccess = useCallback(async () => {
    if (status === 'denied') { Linking.openSettings().catch(() => {}); return; }
    try {
      const p = await requestPermissionsAsync(false, ['audio']);
      if (p.granted) {
        setStatus('loading');
        scan({ force: true });
      } else {
        setStatus(p.canAskAgain ? 'needs-permission' : 'denied');
      }
    } catch (e) { /* stay as is */ }
  }, [status, scan]);

  const rescan = useCallback(() => scan({ force: true }), [scan]);
  const value = useMemo(() => ({ status, tracks, requestAccess, rescan }), [status, tracks, requestAccess, rescan]);
  return <LocalMusicContext.Provider value={value}>{children}</LocalMusicContext.Provider>;
}

export function useLocalMusic() {
  const ctx = useContext(LocalMusicContext);
  if (!ctx) throw new Error('useLocalMusic must be used inside <LocalMusicProvider>');
  return ctx;
}
