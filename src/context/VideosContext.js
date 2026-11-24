import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  VIDEOS_SUPPORTED, checkAccess, requestAccess, changeFolder, listVideos,
} from '../utils/videoSource';

// The Videos side of the app (Home → Videos): the videos on this phone (or the computer's chosen
// folder), grouped into folders like MX Player, and where each one was stopped (to resume).
// Loaded the first time Videos is opened.

const POSITIONS_KEY = 'viberoom:video-positions:v1'; // { [videoId]: seconds }
const MAX_POSITIONS = 300;
const VideosContext = createContext(null);

export function VideosProvider({ children }) {
  const [access, setAccess] = useState('unknown'); // unknown | granted | needs-permission | denied
  const [videos, setVideos] = useState(null); // null until loaded
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const positions = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setVideos(await listVideos());
    } catch (e) {
      setError(e.message || 'Couldn\'t read the videos.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Called when Videos is shown: check access, then list (once; refresh() lists again).
  const start = useCallback(async () => {
    if (!VIDEOS_SUPPORTED) return;
    const a = await checkAccess().catch(() => 'needs-permission');
    setAccess(a);
    if (a === 'granted' && videos === null) await load();
  }, [videos, load]);

  const allow = useCallback(async () => {
    const a = await requestAccess(access).catch(() => 'needs-permission');
    setAccess(a);
    if (a === 'granted') await load();
  }, [access, load]);

  const pickFolder = useCallback(async () => {
    if (!changeFolder) return;
    const a = await changeFolder();
    setAccess(a);
    if (a === 'granted') await load();
  }, [load]);

  // Folders, biggest first: [{ name, videos: [...] }]
  const folders = useMemo(() => {
    const map = new Map();
    for (const v of videos || []) {
      if (!map.has(v.folder)) map.set(v.folder, []);
      map.get(v.folder).push(v);
    }
    return [...map.entries()].map(([name, list]) => ({ name, videos: list }))
      .sort((a, b) => b.videos.length - a.videos.length || a.name.localeCompare(b.name));
  }, [videos]);

  const loadPositions = useCallback(async () => {
    if (positions.current) return positions.current;
    try { positions.current = JSON.parse((await AsyncStorage.getItem(POSITIONS_KEY)) || '{}'); } catch (e) { positions.current = {}; }
    return positions.current;
  }, []);

  /** Where `id` was stopped (seconds), or 0. */
  const positionOf = useCallback(async (id) => ((await loadPositions())[id] || 0), [loadPositions]);

  /** Remember where `id` was stopped; 0 forgets it (watched to the end). */
  const savePosition = useCallback(async (id, seconds) => {
    const map = await loadPositions();
    delete map[id];
    if (seconds > 0) map[id] = Math.round(seconds);
    const keys = Object.keys(map);
    if (keys.length > MAX_POSITIONS) keys.slice(0, keys.length - MAX_POSITIONS).forEach((k) => delete map[k]);
    AsyncStorage.setItem(POSITIONS_KEY, JSON.stringify(map)).catch(() => {});
  }, [loadPositions]);

  const value = useMemo(() => ({
    supported: VIDEOS_SUPPORTED, access, videos, folders, loading, error,
    start, allow, refresh: load, pickFolder: changeFolder ? pickFolder : null,
    positionOf, savePosition,
  }), [access, videos, folders, loading, error, start, allow, load, pickFolder, positionOf, savePosition]);

  return <VideosContext.Provider value={value}>{children}</VideosContext.Provider>;
}

export function useVideos() {
  const ctx = useContext(VideosContext);
  if (!ctx) throw new Error('useVideos must be used inside <VideosProvider>');
  return ctx;
}
