import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fetchSongs } from '../api/catalog';

// The shared song library everyone sees. Loaded from the server and saved on the
// phone, so the list still shows when offline (downloaded songs still play).

const CACHE_KEY = 'tunely:catalog:v1';
const CatalogContext = createContext(null);

export function CatalogProvider({ children }) {
  const [songs, setSongs] = useState([]);
  const [status, setStatus] = useState('loading'); // loading | ok | offline | error
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const list = await fetchSongs();
      setSongs(list);
      setStatus('ok');
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(list)).catch(() => {});
    } catch (e) {
      // Offline: fall back to the last saved list.
      try {
        const raw = await AsyncStorage.getItem(CACHE_KEY);
        if (raw) {
          setSongs(JSON.parse(raw));
          setStatus('offline');
        } else {
          setStatus('error');
        }
      } catch (err) {
        setStatus('error');
      }
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Show the saved list instantly, then refresh from the server.
    AsyncStorage.getItem(CACHE_KEY)
      .then((raw) => { if (raw) setSongs((cur) => (cur.length ? cur : JSON.parse(raw))); })
      .catch(() => {})
      .finally(() => load());
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  // Artists, albums and genres, built from the songs.
  // A song by "Sushin Shyam, Vaasi" counts for both artists.
  const artists = useMemo(() => {
    const map = new Map();
    songs.forEach((s) => {
      splitArtists(s.artist).forEach((name) => {
        const key = name.toLowerCase();
        const a = map.get(key) || { name, artwork: null, count: 0 };
        a.count += 1;
        if (!a.artwork && s.artwork) a.artwork = s.artwork;
        map.set(key, a);
      });
    });
    return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [songs]);

  // Albums, newest first. The album's artist is the one on most of its songs.
  const albums = useMemo(() => {
    const map = new Map();
    songs.forEach((s) => {
      if (!s.album) return;
      const key = s.album.toLowerCase();
      const a = map.get(key) || { name: s.album, artwork: null, count: 0, latest: '', byArtist: new Map() };
      a.count += 1;
      if (!a.artwork && s.artwork) a.artwork = s.artwork;
      if ((s.createdAt || '') > a.latest) a.latest = s.createdAt || '';
      const lead = splitArtists(s.artist)[0];
      if (lead) a.byArtist.set(lead, (a.byArtist.get(lead) || 0) + 1);
      map.set(key, a);
    });
    return [...map.values()]
      .map(({ byArtist, ...a }) => ({ ...a, artist: [...byArtist.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || '' }))
      .sort((a, b) => (b.latest > a.latest ? 1 : b.latest < a.latest ? -1 : a.name.localeCompare(b.name)));
  }, [songs]);

  const genres = useMemo(() => {
    const map = new Map();
    songs.forEach((s) => {
      if (!s.genre) return;
      const key = s.genre.toLowerCase();
      map.set(key, { name: s.genre, count: (map.get(key)?.count || 0) + 1 });
    });
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [songs]);

  const value = useMemo(() => ({ songs, artists, albums, genres, status, refreshing, refresh }),
    [songs, artists, albums, genres, status, refreshing, refresh]);
  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

// "Sushin Shyam, Vaasi" / "A & B" / "A feat. B" -> ['Sushin Shyam', 'Vaasi']
export function splitArtists(artist) {
  return (artist || '').split(/\s*,\s*|\s+&\s+|\s+(?:feat\.?|ft\.?)\s+/i).map((a) => a.trim()).filter(Boolean);
}

// Does this song feature the named artist?
export const hasArtist = (track, name) => splitArtists(track.artist).some((a) => a.toLowerCase() === name.toLowerCase());

export function useCatalog() {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error('useCatalog must be used inside <CatalogProvider>');
  return ctx;
}
