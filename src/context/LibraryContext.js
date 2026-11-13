import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { saveSong, restore, removeSaved, deleteLocal } from '../utils/offline';

// Everything the user owns: liked songs, their playlists and offline downloads.
// Saved to the phone with AsyncStorage so it survives app restarts.
// Offline song files are handled by utils/offline.js (phone) / offline.web.js (browser).

const STORAGE_KEY = 'tunely:library:v2';
const OLD_STORAGE_KEY = 'tunely:library:v1';
const LibraryContext = createContext(null);

export function LibraryProvider({ children }) {
  const [ready, setReady] = useState(false);
  const [liked, setLiked] = useState([]);          // [track]
  const [playlists, setPlaylists] = useState([]);  // [{ id, title, createdAt, tracks: [track] }]
  const [downloads, setDownloads] = useState({});  // { [trackId]: { track, uri, size } }
  const [downloading, setDownloading] = useState({}); // { [trackId]: true }
  const [recent, setRecent] = useState([]);        // [track], most recent first

  // ---- load once on startup ----
  useEffect(() => {
    (async () => {
      // One-time cleanup of data from the old online-catalogue version of the app.
      try {
        const old = await AsyncStorage.getItem(OLD_STORAGE_KEY);
        if (old) {
          Object.values(JSON.parse(old).downloads || {}).forEach((d) => {
            [d.uri, d.track?.artwork].forEach(deleteLocal);
          });
          await AsyncStorage.removeItem(OLD_STORAGE_KEY);
        }
        const keys = await AsyncStorage.getAllKeys();
        const stale = keys.filter((k) => k.startsWith('tunely:cache:v1:'));
        if (stale.length) await AsyncStorage.multiRemove(stale);
      } catch (e) { /* ignore */ }

      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          setLiked(saved.liked || []);
          setPlaylists(saved.playlists || []);
          setRecent(saved.recent || []);
          // Drop download entries whose file has gone missing.
          const ok = {};
          await Promise.all(Object.entries(saved.downloads || {}).map(async ([id, d]) => {
            const entry = await restore(d);
            if (entry) ok[id] = entry;
          }));
          setDownloads(ok);
        }
      } catch (e) {
        console.warn('Could not load library', e);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // ---- save whenever something changes (after the first load) ----
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ liked, playlists, downloads, recent })).catch(() => {});
  }, [ready, liked, playlists, downloads, recent]);


  // ---- recently played ----
  const addRecent = useCallback((track) => {
    const { qid, ...clean } = track; // queue key isn't part of the song
    setRecent((prev) => [clean, ...prev.filter((t) => t.id !== track.id)].slice(0, 30));
  }, []);

  // ---- liked songs ----
  const likedIds = useMemo(() => new Set(liked.map((t) => t.id)), [liked]);
  const isLiked = useCallback((id) => likedIds.has(id), [likedIds]);
  const toggleLike = useCallback((track) => {
    setLiked((prev) => (prev.some((t) => t.id === track.id)
      ? prev.filter((t) => t.id !== track.id)
      : [track, ...prev]));
  }, []);

  // ---- playlists ----
  const createPlaylist = useCallback((title, firstTrack) => {
    const playlist = {
      id: `u-${Date.now()}`,
      title: title.trim() || `My Playlist #${Date.now() % 1000}`,
      createdAt: Date.now(),
      tracks: firstTrack ? [firstTrack] : [],
    };
    setPlaylists((prev) => [playlist, ...prev]);
    return playlist;
  }, []);

  const deletePlaylist = useCallback((id) => {
    setPlaylists((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const renamePlaylist = useCallback((id, title) => {
    setPlaylists((prev) => prev.map((p) => (p.id === id ? { ...p, title } : p)));
  }, []);

  const addToPlaylist = useCallback((playlistId, track) => {
    setPlaylists((prev) => prev.map((p) => (p.id === playlistId && !p.tracks.some((t) => t.id === track.id)
      ? { ...p, tracks: [...p.tracks, track] }
      : p)));
  }, []);

  const removeFromPlaylist = useCallback((playlistId, trackId) => {
    setPlaylists((prev) => prev.map((p) => (p.id === playlistId
      ? { ...p, tracks: p.tracks.filter((t) => t.id !== trackId) }
      : p)));
  }, []);

  // ---- offline downloads ----
  const downloadsRef = useRef(downloads);
  downloadsRef.current = downloads;

  const isDownloaded = useCallback((id) => !!downloads[id], [downloads]);
  const isDownloading = useCallback((id) => !!downloading[id], [downloading]);

  const download = useCallback(async (track) => {
    if (downloadsRef.current[track.id] || downloading[track.id]) return;
    if (typeof track.url !== 'string') return; // bundled files are already offline
    setDownloading((d) => ({ ...d, [track.id]: true }));
    try {
      const entry = await saveSong(track);
      setDownloads((d) => ({ ...d, [track.id]: entry }));
    } catch (e) {
      console.warn('Download failed', track.title, e);
      throw e;
    } finally {
      setDownloading((d) => {
        const n = { ...d };
        delete n[track.id];
        return n;
      });
    }
  }, [downloading]);

  const downloadMany = useCallback(async (list) => {
    // One at a time, so we don't flood the network.
    for (const t of list) {
      try { await download(t); } catch (e) { /* keep going */ }
    }
  }, [download]);

  const removeDownload = useCallback((id) => {
    const entry = downloadsRef.current[id];
    if (entry) removeSaved(entry);
    setDownloads((d) => {
      const n = { ...d };
      delete n[id];
      return n;
    });
  }, []);

  // Playback uses the local file when a song is downloaded.
  const playableSource = useCallback((track) => {
    const local = downloadsRef.current[track.id];
    if (local) return { uri: local.uri };
    return typeof track.url === 'string' ? { uri: track.url } : track.url;
  }, []);

  const downloadedTracks = useMemo(() => Object.values(downloads).map((d) => d.track), [downloads]);
  const downloadedBytes = useMemo(() => Object.values(downloads).reduce((s, d) => s + (d.size || 0), 0), [downloads]);

  const value = useMemo(() => ({
    ready,
    recent, addRecent,
    liked, isLiked, toggleLike,
    playlists, createPlaylist, deletePlaylist, renamePlaylist, addToPlaylist, removeFromPlaylist,
    downloadedTracks, downloadedBytes, isDownloaded, isDownloading, download, downloadMany, removeDownload, playableSource,
  }), [ready, recent, addRecent, liked, isLiked, toggleLike, playlists, createPlaylist, deletePlaylist, renamePlaylist, addToPlaylist,
    removeFromPlaylist, downloadedTracks, downloadedBytes, isDownloaded, isDownloading, download, downloadMany,
    removeDownload, playableSource]);

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}

export function useLibrary() {
  const ctx = useContext(LibraryContext);
  if (!ctx) throw new Error('useLibrary must be used inside <LibraryProvider>');
  return ctx;
}
