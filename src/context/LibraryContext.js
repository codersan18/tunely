import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File, Directory, Paths } from 'expo-file-system';

// Everything the user owns: liked songs, their playlists and offline downloads.
// Saved to the phone with AsyncStorage so it survives app restarts.

const STORAGE_KEY = 'tunely:library:v2';
const OLD_STORAGE_KEY = 'tunely:library:v1';
const LibraryContext = createContext(null);

const downloadsDir = () => {
  const dir = new Directory(Paths.document, 'downloads');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
};

const safeName = (id) => id.replace(/[^a-zA-Z0-9_-]/g, '_');

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
            [d.uri, d.track?.artwork].forEach((u) => {
              try { if (u && !u.startsWith('http')) { const f = new File(u); if (f.exists) f.delete(); } } catch (e) { /* ignore */ }
            });
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
          Object.entries(saved.downloads || {}).forEach(([id, d]) => {
            try { if (new File(d.uri).exists) ok[id] = d; } catch (e) { /* skip */ }
          });
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
      const target = new File(downloadsDir(), `${safeName(track.id)}.mp3`);
      const file = await File.downloadFileAsync(track.url, target, { idempotent: true });
      let size = 0;
      try { size = file.info().size || 0; } catch (e) { /* ignore */ }
      // Save the cover art too, so the song looks right with no internet.
      let saved = track;
      if (typeof track.artwork === 'string' && track.artwork.startsWith('http')) {
        try {
          const artTarget = new File(downloadsDir(), `${safeName(track.id)}.jpg`);
          const art = await File.downloadFileAsync(track.artwork, artTarget, { idempotent: true });
          saved = { ...track, artwork: art.uri, remoteArtwork: track.artwork };
          try { size += art.info().size || 0; } catch (e) { /* ignore */ }
        } catch (e) { /* keep the online artwork */ }
      }
      setDownloads((d) => ({ ...d, [track.id]: { track: saved, uri: file.uri, size } }));
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
    if (entry) {
      try { const f = new File(entry.uri); if (f.exists) f.delete(); } catch (e) { /* ignore */ }
      try {
        const art = entry.track.artwork;
        if (art && !art.startsWith('http')) { const f = new File(art); if (f.exists) f.delete(); }
      } catch (e) { /* ignore */ }
    }
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
