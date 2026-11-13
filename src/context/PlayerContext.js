import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { useLibrary } from './LibraryContext';
import { useCatalog } from './CatalogContext';
import { pickSimilar } from '../utils/smartShuffle';

const PlayerContext = createContext(null);

// repeat modes: 'off' -> 'all' -> 'one'
const nextRepeat = { off: 'all', all: 'one', one: 'off' };
// shuffle modes: 'off' -> 'on' (random) -> 'smart' (similar songs from the whole library)
const nextShuffle = { off: 'on', on: 'smart', smart: 'off' };
const SKIP_SECONDS = 30; // skipping a song before this counts as "not this one"

// The same song can sit in the queue twice (e.g. "Play next" on a song already queued),
// so every queue entry gets its own key `qid` on top of the song's `id`.
let qidCounter = 0;
const toEntry = (track, extra) => ({ ...track, ...extra, qid: `q${++qidCounter}` });

export function PlayerProvider({ children }) {
  const { playableSource, addRecent, downloadedTracks } = useLibrary();
  const { songs, status: catalogStatus } = useCatalog();
  const player = useAudioPlayer(null, { updateInterval: 500 });
  const status = useAudioPlayerStatus(player);

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

  // Allow playback while the app is in the background / screen is off.
  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => {});
  }, []);

  // ---- smart shuffle state ----
  const played = useRef([]);          // song ids played this session, newest first
  const skipped = useRef(new Set());  // songs skipped early this session
  const context = useRef(new Set());  // ids of the list the user started playing from
  const [smartNext, setSmartNext] = useState(null);
  const [smartSeed, setSmartSeed] = useState(0); // bump to pick again

  // Songs that can play right now: everything when online, only downloads when offline.
  const playable = useMemo(() => {
    if (catalogStatus === 'offline' || catalogStatus === 'error') return downloadedTracks;
    return [...new Map([...songs, ...downloadedTracks].map((t) => [t.id, t])).values()];
  }, [songs, downloadedTracks, catalogStatus]);

  // Load + play whenever the current queue entry changes.
  const loadedQid = useRef(null);
  useEffect(() => {
    if (!currentTrack || loadedQid.current === currentTrack.qid) return;
    loadedQid.current = currentTrack.qid;
    player.replace(playableSource(currentTrack));
    player.play();
    addRecent(currentTrack);
    played.current = [currentTrack.id, ...played.current.filter((id) => id !== currentTrack.id)].slice(0, 200);
    try {
      player.setActiveForLockScreen(true, {
        title: currentTrack.title,
        artist: currentTrack.artist,
        albumTitle: currentTrack.album,
        artworkUrl: currentTrack.artwork || undefined,
      });
    } catch (e) {
      // Lock screen controls are optional (not available in every environment).
    }
  }, [currentTrack, player, playableSource, addRecent]);

  // ---- basic playback ----
  const playTrack = useCallback((track, list) => {
    if (currentTrack && currentTrack.id === track.id && !list) {
      player.play();
      return;
    }
    const source = list && list.length ? list : [track];
    context.current = new Set(source.map((t) => t.id));
    const newQueue = source.map(toEntry);
    const i = source.findIndex((t) => t.id === track.id);
    setQueue(newQueue);
    setIndex(i < 0 ? 0 : i);
  }, [currentTrack, player]);

  const togglePlay = useCallback(() => {
    if (!currentTrack) return;
    if (status.playing) player.pause();
    else {
      if (status.didJustFinish || (status.duration && status.currentTime >= status.duration - 0.5)) {
        player.seekTo(0);
      }
      player.play();
    }
  }, [currentTrack, player, status.playing, status.didJustFinish, status.currentTime, status.duration]);

  // Pick the song smart shuffle will play next (shown in the queue).
  useEffect(() => {
    if (!smart || !currentTrack) { setSmartNext(null); return; }
    // Don't repeat songs heard recently; how far back depends on library size.
    const memory = Math.max(1, Math.min(50, Math.floor(playable.length * 0.6)));
    const avoid = new Set([...played.current.slice(0, memory), ...skipped.current]);
    const pick = pickSimilar(currentTrack, playable, { avoid, context: context.current });
    setSmartNext(pick ? toEntry(pick, { smart: true }) : null);
  }, [smart, currentTrack?.qid, playable, smartSeed]); // eslint-disable-line react-hooks/exhaustive-deps

  const restartCurrent = useCallback(() => {
    player.seekTo(0);
    player.play();
  }, [player]);

  const next = useCallback((auto = false) => {
    if (!queue.length) return;
    if (auto && repeat === 'one') return restartCurrent();
    if (!auto && currentTrack && status.currentTime < SKIP_SECONDS) skipped.current.add(currentTrack.id);
    // Smart shuffle: songs the user queued with "Play next" / "Add to queue" still come first.
    if (smart && !queue[index + 1]?.manual && smartNext) {
      setQueue((q) => [...q.slice(0, index + 1), smartNext, ...q.slice(index + 1)]);
      setIndex(index + 1);
      return;
    }
    let ni;
    if (shuffle && queue.length > 1) {
      do { ni = Math.floor(Math.random() * queue.length); } while (ni === index);
    } else {
      ni = index + 1;
      if (ni >= queue.length) {
        if (repeat === 'off' && auto) { player.pause(); return; }
        ni = 0;
      }
    }
    if (ni === index) restartCurrent();
    else setIndex(ni);
  }, [queue, index, shuffle, smart, smartNext, currentTrack, status.currentTime, repeat, player, restartCurrent]);

  const previous = useCallback(() => {
    if (!queue.length) return;
    // Like most players: go to start if more than 3s in, otherwise previous track.
    if (status.currentTime > 3 || index === 0) return restartCurrent();
    setIndex(index - 1);
  }, [queue, index, status.currentTime, restartCurrent]);

  // When a song ends: honour "stop at end of track", otherwise auto-advance.
  useEffect(() => {
    if (!status.didJustFinish) return;
    if (sleepAfterTrack) {
      setSleepAfterTrack(false);
      player.pause();
      return;
    }
    next(true);
  }, [status.didJustFinish]); // eslint-disable-line react-hooks/exhaustive-deps

  const seekTo = useCallback((seconds) => player.seekTo(seconds), [player]);

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
    if (smartNext && qid === smartNext.qid) return next(false);
    const i = queue.findIndex((t) => t.qid === qid);
    if (i >= 0) setIndex(i);
  }, [queue, smartNext, next]);

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
      player.pause();
      setSleepAt(null);
    }, Math.max(0, sleepAt - Date.now()));
    return () => clearTimeout(t);
  }, [sleepAt, player]);

  const value = useMemo(() => ({
    currentTrack,
    queue,
    upNext,
    isPlaying: status.playing,
    isBuffering: status.isBuffering,
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
    next: () => next(false),
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
