import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { useLibrary } from './LibraryContext';

const PlayerContext = createContext(null);

// repeat modes: 'off' -> 'all' -> 'one'
const nextRepeat = { off: 'all', all: 'one', one: 'off' };

// The same song can sit in the queue twice (e.g. "Play next" on a song already queued),
// so every queue entry gets its own key `qid` on top of the song's `id`.
let qidCounter = 0;
const toEntry = (track) => ({ ...track, qid: `q${++qidCounter}` });

export function PlayerProvider({ children }) {
  const { playableSource, addRecent } = useLibrary();
  const player = useAudioPlayer(null, { updateInterval: 500 });
  const status = useAudioPlayerStatus(player);

  const [queue, setQueue] = useState([]);
  const [index, setIndex] = useState(-1);
  const [shuffle, setShuffle] = useState(false);
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

  // Load + play whenever the current queue entry changes.
  const loadedQid = useRef(null);
  useEffect(() => {
    if (!currentTrack || loadedQid.current === currentTrack.qid) return;
    loadedQid.current = currentTrack.qid;
    player.replace(playableSource(currentTrack));
    player.play();
    addRecent(currentTrack);
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

  const restartCurrent = useCallback(() => {
    player.seekTo(0);
    player.play();
  }, [player]);

  const next = useCallback((auto = false) => {
    if (!queue.length) return;
    if (auto && repeat === 'one') return restartCurrent();
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
  }, [queue, index, shuffle, repeat, player, restartCurrent]);

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
    setQueue((q) => [...q.slice(0, index + 1), toEntry(track), ...q.slice(index + 1)]);
  }, [index, playTrack]);

  const addToQueue = useCallback((track) => {
    if (index < 0) return playTrack(track);
    setQueue((q) => [...q, toEntry(track)]);
  }, [index, playTrack]);

  const removeFromQueue = useCallback((qid) => {
    const i = queue.findIndex((t) => t.qid === qid);
    if (i < 0 || i === index) return; // can't remove the song that's playing
    setQueue((q) => q.filter((t) => t.qid !== qid));
    if (i < index) setIndex((x) => x - 1);
  }, [queue, index]);

  const jumpTo = useCallback((qid) => {
    const i = queue.findIndex((t) => t.qid === qid);
    if (i >= 0) setIndex(i);
  }, [queue]);

  const clearUpNext = useCallback(() => {
    setQueue((q) => q.slice(0, index + 1));
  }, [index]);

  const upNext = useMemo(() => (index >= 0 ? queue.slice(index + 1) : []), [queue, index]);

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
    repeat,
    sleepAt,
    sleepAfterTrack,
    playTrack,
    togglePlay,
    next: () => next(false),
    previous,
    seekTo,
    toggleShuffle: () => setShuffle((s) => !s),
    cycleRepeat: () => setRepeat((r) => nextRepeat[r]),
    playNext,
    addToQueue,
    removeFromQueue,
    jumpTo,
    clearUpNext,
    setSleepTimer,
  }), [currentTrack, queue, upNext, status.playing, status.isBuffering, status.currentTime, status.duration,
    shuffle, repeat, sleepAt, sleepAfterTrack, playTrack, togglePlay, next, previous, seekTo,
    playNext, addToQueue, removeFromQueue, jumpTo, clearUpNext, setSleepTimer]);

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside <PlayerProvider>');
  return ctx;
}
