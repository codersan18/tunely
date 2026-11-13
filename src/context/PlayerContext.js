import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createAudioPlaylist, useAudioPlaylistStatus, setAudioModeAsync } from 'expo-audio';
import { useLibrary } from './LibraryContext';
import { useCatalog } from './CatalogContext';
import { pickSimilar } from '../utils/smartShuffle';

const PlayerContext = createContext(null);

// repeat modes: 'off' -> 'all' -> 'one'
const nextRepeat = { off: 'all', all: 'one', one: 'off' };
// shuffle modes: 'off' -> 'on' (random) -> 'smart' (similar songs from the whole library)
const nextShuffle = { off: 'on', on: 'smart', smart: 'off' };
const SKIP_SECONDS = 30;     // leaving a song before this counts as "not this one" for smart shuffle
const MAX_NATIVE_ITEMS = 60; // start a fresh native playlist after this many songs

// The same song can sit in the queue twice (e.g. "Play next" on a song already queued),
// so every queue entry gets its own key `qid` on top of the song's `id`.
let qidCounter = 0;
const toEntry = (track, extra) => ({ ...track, ...extra, qid: `q${++qidCounter}` });

const metaOf = (t) => ({ title: t.title, artist: t.artist, albumTitle: t.album || undefined, artworkUrl: t.artwork || undefined });

// How playback works
// -------------------
// Songs play through expo-audio's native playlist, because only a native playlist gets working
// Next / Previous buttons on the lock screen and in the notification, and it moves to the next
// song by itself even when the app is in the background.
//
// The app keeps the real queue (this file). The native playlist holds the songs already played,
// the current song, and the ONE song that should play next (`plannedNext`: a queued song, the smart
// shuffle pick, a random pick, or simply the next in the list). Whenever the native playlist moves
// (song ended, lock screen button, our own next/previous), we look up which entry it is now on
// and update the queue to match.
export function PlayerProvider({ children }) {
  const { playableSource, addRecent, downloadedTracks } = useLibrary();
  const { songs, status: catalogStatus } = useCatalog();

  // The native playlist. Replaced with a fresh one after a playback error (it can't recover by itself).
  const [playlist, setPlaylist] = useState(() => createAudioPlaylist({ updateInterval: 500 }));
  const status = useAudioPlaylistStatus(playlist);
  useEffect(() => () => { try { playlist.release(); } catch (e) { /* already gone */ } }, [playlist]);

  const native = useRef([]);           // queue entries in the same order as the native playlist
  const lastNativeIndex = useRef(-1);  // native position we last synced to
  const lockScreenOn = useRef(false);

  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(-1);
  const [shuffleMode, setShuffleMode] = useState('off');
  const shuffle = shuffleMode === 'on';
  const smart = shuffleMode === 'smart';
  const [repeat, setRepeat] = useState('off');

  // Sleep timer: either a time (ms timestamp) or "stop at end of this song".
  const [sleepAt, setSleepAt] = useState(null);
  const [sleepAfterTrack, setSleepAfterTrack] = useState(false);

  const currentTrack = index >= 0 ? queue[index] : null;

  // Latest values for code that runs from native events.
  const queueRef = useRef(queue); queueRef.current = queue;
  const indexRef = useRef(index); indexRef.current = index;

  // Allow playback while the app is in the background / screen is off.
  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix', // required for lock screen controls
    }).catch(() => {});
  }, []);

  // ---- smart shuffle state ----
  const played = useRef([]);          // song ids played this session, newest first
  const skipped = useRef(new Set());  // songs skipped early this session
  const context = useRef(new Set());  // ids of the list the user started playing from
  const [smartNext, setSmartNext] = useState(null);
  const [smartSeed, setSmartSeed] = useState(0); // bump to pick again
  const [randomNext, setRandomNext] = useState(null);

  // Songs that can play right now: everything when online, only downloads when offline.
  const playable = useMemo(() => {
    if (catalogStatus === 'offline' || catalogStatus === 'error') return downloadedTracks;
    return [...new Map([...songs, ...downloadedTracks].map((t) => [t.id, t])).values()];
  }, [songs, downloadedTracks, catalogStatus]);

  useEffect(() => {
    if (!smart || !currentTrack) { setSmartNext(null); return; }
    // Don't repeat songs heard recently; how far back depends on library size.
    const memory = Math.max(1, Math.min(50, Math.floor(playable.length * 0.6)));
    const avoid = new Set([...played.current.slice(0, memory), ...skipped.current]);
    const pick = pickSimilar(currentTrack, playable, { avoid, context: context.current });
    setSmartNext(pick ? toEntry(pick, { smart: true }) : null);
  }, [smart, currentTrack?.qid, playable, smartSeed]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!shuffle || !currentTrack || queue.length < 2) { setRandomNext(null); return; }
    let ni;
    do { ni = Math.floor(Math.random() * queue.length); } while (ni === index);
    setRandomNext(queue[ni]);
  }, [shuffle, currentTrack?.qid, queue.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // The one song that should play after this one.
  const plannedNext = useMemo(() => {
    if (!currentTrack || sleepAfterTrack) return null;
    const after = queue[index + 1];
    if (after?.manual) return after;     // "Play next" / "Add to queue" always come first
    if (smart) return smartNext;
    if (shuffle) return randomNext;
    if (after) return after;
    if (repeat === 'all' && queue.length) return queue[0];
    return null;
  }, [currentTrack, sleepAfterTrack, queue, index, smart, smartNext, shuffle, randomNext, repeat]);

  // ---- native playlist helpers ----
  const truncateAfter = useCallback((pos) => {
    for (let i = playlist.trackCount - 1; i > pos; i -= 1) playlist.remove(i);
    native.current.length = Math.min(native.current.length, pos + 1);
  }, [playlist]);

  // Native playlist moved (song ended, lock screen button, next/previous): make the queue follow.
  const followNative = useCallback(() => {
    const pos = playlist.currentIndex;
    if (pos === lastNativeIndex.current) return;
    lastNativeIndex.current = pos;
    const entry = native.current[pos];
    if (!entry) return;
    const q = queueRef.current;
    const i = indexRef.current;
    if (q[i]?.qid === entry.qid) return;
    const at = q.findIndex((t) => t.qid === entry.qid);
    if (at >= 0) {
      setIndex(at);
    } else {
      // A smart shuffle pick: it joins the queue right after the song that was playing.
      setQueue([...q.slice(0, i + 1), entry, ...q.slice(i + 1)]);
      setIndex(i + 1);
    }
  }, [playlist]);

  // Note how far into each song we got, to spot skips (for smart shuffle).
  const lastPos = useRef({ qid: null, id: null, time: 0, duration: 0 });
  useEffect(() => {
    const before = lastPos.current;
    followNative();
    const now = native.current[playlist.currentIndex];
    if (before.qid && now && now.qid !== before.qid
      && before.time < SKIP_SECONDS && before.duration && before.time < before.duration - 3) {
      skipped.current.add(before.id);
    }
    if (now) lastPos.current = { qid: now.qid, id: now.id, time: status.currentTime || 0, duration: status.duration || 0 };
  }, [status.currentIndex, status.currentTime, followNative]); // eslint-disable-line react-hooks/exhaustive-deps

  // The queue moved to a song the native playlist isn't on (user picked a song): load it.
  const [reloadAt, setReloadAt] = useState(null); // { qid, seconds } after rebuilding the playlist
  useEffect(() => {
    if (!currentTrack) return;
    const pos = playlist.currentIndex;
    if (playlist.trackCount > 0 && native.current[pos]?.qid === currentTrack.qid) return;
    if (playlist.trackCount >= MAX_NATIVE_ITEMS) {
      playlist.clear();
      native.current = [];
    } else {
      truncateAfter(pos);
    }
    playlist.add(playableSource(currentTrack));
    native.current.push(currentTrack);
    const at = native.current.length - 1;
    playlist.skipTo(at);
    lastNativeIndex.current = playlist.currentIndex;
    if (reloadAt?.qid === currentTrack.qid && reloadAt.seconds > 1) playlist.seekTo(reloadAt.seconds).catch(() => {});
    playlist.play();
  }, [currentTrack?.qid, playlist]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the native "next song" in step with plannedNext.
  useEffect(() => {
    if (!currentTrack) return;
    const pos = playlist.currentIndex;
    if (native.current[pos]?.qid !== currentTrack.qid) return;
    const already = native.current.length === pos + 2 && native.current[pos + 1]?.qid === plannedNext?.qid;
    if (already || (!plannedNext && native.current.length === pos + 1)) return;
    truncateAfter(pos);
    if (plannedNext) {
      playlist.add(playableSource(plannedNext));
      native.current.push(plannedNext);
    }
  }, [currentTrack?.qid, plannedNext?.qid, playlist, truncateAfter, playableSource]); // eslint-disable-line react-hooks/exhaustive-deps

  // Repeat one: let the native player loop the song.
  useEffect(() => {
    try { playlist.loop = repeat === 'one' && !sleepAfterTrack ? 'single' : 'none'; } catch (e) { /* ignore */ }
  }, [repeat, sleepAfterTrack, playlist]);

  // Lock screen / notification: title, artist, cover and Previous / Play-Pause / Next buttons.
  useEffect(() => {
    if (!currentTrack) return;
    addRecent(currentTrack);
    played.current = [currentTrack.id, ...played.current.filter((id) => id !== currentTrack.id)].slice(0, 200);
    try {
      if (!lockScreenOn.current) {
        playlist.setActiveForLockScreen(true, metaOf(currentTrack), { showNextTrack: true, showPreviousTrack: true });
        lockScreenOn.current = true;
      } else {
        playlist.updateLockScreenMetadata(metaOf(currentTrack));
      }
    } catch (e) {
      // Lock screen controls are optional (not available in every environment).
    }
  }, [currentTrack?.qid, playlist]); // eslint-disable-line react-hooks/exhaustive-deps

  // A playback error (e.g. the network dropped) leaves the native player stuck, so build a new one
  // and carry on from the same spot. If the same song fails twice in a row, move on to the next one.
  const failedQid = useRef(null);
  useEffect(() => {
    const sub = playlist.addListener('playlistStatusUpdate', (s) => {
      if (!s?.error) return;
      const entry = native.current[playlist.currentIndex];
      const seconds = s.currentTime || 0;
      const fresh = createAudioPlaylist({ updateInterval: 500 });
      native.current = [];
      lastNativeIndex.current = -1;
      lockScreenOn.current = false;
      if (entry && failedQid.current === entry.qid) {
        failedQid.current = null;
        setReloadAt(null);
        setPlaylist(fresh);
        const q = queueRef.current;
        const i = q.findIndex((t) => t.qid === entry.qid);
        if (i >= 0 && i + 1 < q.length) setIndex(i + 1);
      } else {
        failedQid.current = entry?.qid || null;
        setReloadAt(entry ? { qid: entry.qid, seconds } : null);
        setPlaylist(fresh);
      }
    });
    return () => sub.remove();
  }, [playlist]);

  // Stop-at-end-of-song: once the song has finished, switch the option off again.
  useEffect(() => {
    if (sleepAfterTrack && !status.playing && status.duration > 0 && status.currentTime >= status.duration - 1.5) {
      setSleepAfterTrack(false);
    }
  }, [sleepAfterTrack, status.playing, status.currentTime, status.duration]);

  // ---- basic playback ----
  const playTrack = useCallback((track, list) => {
    if (currentTrack && currentTrack.id === track.id && !list) {
      playlist.play();
      return;
    }
    const source = list && list.length ? list : [track];
    context.current = new Set(source.map((t) => t.id));
    const newQueue = source.map((t) => toEntry(t));
    const i = source.findIndex((t) => t.id === track.id);
    setQueue(newQueue);
    setIndex(i < 0 ? 0 : i);
  }, [currentTrack, playlist]);

  const togglePlay = useCallback(() => {
    if (!currentTrack) return;
    if (status.playing) { playlist.pause(); return; }
    if (status.duration && status.currentTime >= status.duration - 0.5) playlist.seekTo(0).catch(() => {});
    playlist.play();
  }, [currentTrack, playlist, status.playing, status.currentTime, status.duration]);

  const seekTo = useCallback((seconds) => { playlist.seekTo(seconds).catch(() => {}); }, [playlist]);

  const next = useCallback(() => {
    if (!currentTrack) return;
    if (playlist.currentIndex < playlist.trackCount - 1) {
      playlist.next();
      followNative();
    } else if (queue.length > 1) {
      setIndex(index + 1 < queue.length ? index + 1 : 0); // end of the list: wrap around
    } else {
      playlist.seekTo(0).catch(() => {});
    }
  }, [currentTrack, playlist, followNative, queue.length, index]);

  const previous = useCallback(() => {
    if (!currentTrack) return;
    // Like most players: go to the start if more than 3s in, otherwise the song before.
    if (status.currentTime > 3) { playlist.seekTo(0).catch(() => {}); return; }
    if (playlist.currentIndex > 0) {
      playlist.previous();
      followNative();
    } else if (index > 0) {
      setIndex(index - 1);
    } else {
      playlist.seekTo(0).catch(() => {});
    }
  }, [currentTrack, playlist, followNative, status.currentTime, index]);

  // ---- queue management ----
  const playNext = useCallback((track) => {
    if (index < 0) return playTrack(track);
    setQueue((q) => [...q.slice(0, index + 1), toEntry(track, { manual: true }), ...q.slice(index + 1)]);
  }, [index, playTrack]);

  const addToQueue = useCallback((track) => {
    if (index < 0) return playTrack(track);
    setQueue((q) => {
      // Keep "Add to queue" songs together, right after other queued songs.
      let at = index + 1;
      while (at < q.length && q[at].manual) at += 1;
      return smart ? [...q.slice(0, at), toEntry(track, { manual: true }), ...q.slice(at)] : [...q, toEntry(track, { manual: true })];
    });
  }, [index, playTrack, smart]);

  const removeFromQueue = useCallback((qid) => {
    if (smartNext && qid === smartNext.qid) { // "not this one": pick another
      skipped.current.add(smartNext.id);
      setSmartSeed((x) => x + 1);
      return;
    }
    const i = queue.findIndex((t) => t.qid === qid);
    if (i < 0 || i === index) return; // can't remove the song that's playing
    setQueue((q) => q.filter((t) => t.qid !== qid));
    if (i < index) setIndex((x) => x - 1);
  }, [queue, index, smartNext]);

  const jumpTo = useCallback((qid) => {
    if (plannedNext && qid === plannedNext.qid) return next();
    const i = queue.findIndex((t) => t.qid === qid);
    if (i >= 0) setIndex(i);
  }, [queue, plannedNext, next]);

  const clearUpNext = useCallback(() => {
    setQueue((q) => q.slice(0, index + 1));
  }, [index]);

  // In smart shuffle the queued songs come first, then the smart pick; the rest of the list is skipped.
  const upNext = useMemo(() => {
    if (index < 0) return [];
    const rest = queue.slice(index + 1);
    if (!smart) return rest;
    const manual = [];
    for (const t of rest) { if (!t.manual) break; manual.push(t); }
    return smartNext ? [...manual, smartNext] : manual;
  }, [queue, index, smart, smartNext]);

  // ---- sleep timer ----
  const setSleepTimer = useCallback((minutes) => {
    // minutes: number | 'end' | null (cancel)
    if (minutes === 'end') { setSleepAt(null); setSleepAfterTrack(true); return; }
    setSleepAfterTrack(false);
    setSleepAt(minutes ? Date.now() + minutes * 60 * 1000 : null);
  }, []);

  useEffect(() => {
    if (!sleepAt) return;
    const t = setTimeout(() => {
      playlist.pause();
      setSleepAt(null);
    }, Math.max(0, sleepAt - Date.now()));
    return () => clearTimeout(t);
  }, [sleepAt, playlist]);

  const value = useMemo(() => ({
    currentTrack,
    queue,
    upNext,
    isPlaying: !!status.playing,
    isBuffering: !!status.isBuffering,
    position: status.currentTime || 0,
    duration: status.duration || 0,
    shuffle,
    smartShuffle: smart,
    shuffleMode,
    repeat,
    sleepAt,
    sleepAfterTrack,
    playTrack,
    togglePlay,
    next,
    previous,
    seekTo,
    toggleShuffle: () => setShuffleMode((m) => nextShuffle[m]),
    cycleRepeat: () => setRepeat((r) => nextRepeat[r]),
    playNext,
    addToQueue,
    removeFromQueue,
    jumpTo,
    clearUpNext,
    setSleepTimer,
  }), [currentTrack, queue, upNext, status.playing, status.isBuffering, status.currentTime, status.duration,
    shuffle, smart, shuffleMode, repeat, sleepAt, sleepAfterTrack, playTrack, togglePlay, next, previous, seekTo,
    playNext, addToQueue, removeFromQueue, jumpTo, clearUpNext, setSleepTimer]);

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside <PlayerProvider>');
  return ctx;
}
