import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlaylist, useAudioPlaylistStatus, setAudioModeAsync } from 'expo-audio';
import { useNetworkState, NetworkStateType } from 'expo-network';
import { useLibrary } from './LibraryContext';
import { useCatalog } from './CatalogContext';
import { useSettings } from './SettingsContext';
import { useLocalMusic } from './LocalMusicContext';
import { pickSimilar } from '../utils/smartShuffle';
import { isLocalCover, lockScreenCover } from '../utils/localCover';
import { addListen } from '../utils/stats';
import { scoped } from '../utils/profileScope';
import { getDeviceId } from '../utils/device';
import { reportPlay } from '../api/catalog';
import { PLAYLIST_OPTIONS, applyEq, applyDataSaver, onPlayerStatus } from '../utils/playerExtras';

const PlayerContext = createContext(null);

// repeat modes: 'off' -> 'all' -> 'one'
const nextRepeat = { off: 'all', all: 'one', one: 'off' };
// shuffle modes: 'off' -> 'on' (random) -> 'smart' (similar songs from the whole library)
const nextShuffle = { off: 'on', on: 'smart', smart: 'off' };
const SKIP_SECONDS = 30;     // leaving a song before this counts as "not this one" for smart shuffle
const MAX_NATIVE_ITEMS = 60; // start a fresh native playlist after this many songs
const RESUME_BASE = 'tunely:player:v1'; // queue, song and position, to carry on after a restart (per profile)
const SLEEP_FADE_MS = 30000;         // the sleep timer fades the music out over its last 30 s
const PLAY_SECONDS = 30;             // listening this long (or half a short song) counts as a play

// The same song can sit in the queue twice (e.g. "Play next" on a song already queued),
// so every queue entry gets its own key `qid` on top of the song's `id`.
let qidCounter = 0;
const toEntry = (track, extra) => ({ ...track, ...extra, qid: `q${++qidCounter}` });

// Lock screen: covers of songs on the phone are added once read from the file (see below).
const metaOf = (t) => ({
  title: t.title, artist: t.artist, albumTitle: t.album || undefined,
  artworkUrl: (t.artwork && !isLocalCover(t.artwork) && t.artwork) || undefined,
});

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
  const { transitions, dataSaver, speed, eqOn, eqBands } = useSettings();
  const network = useNetworkState();

  // The native playlist. One for the whole app session: after a playback error, play() prepares it
  // again (patches/expo-audio+*.patch), so it never has to be rebuilt.
  const [playlist] = useState(() => createAudioPlaylist(PLAYLIST_OPTIONS));
  const status = useAudioPlaylistStatus(playlist);
  useEffect(() => () => { try { playlist.release(); } catch (e) { /* already gone */ } }, [playlist]);

  // Liked songs, playlists and "Jump back in" keep their own copy of each song, saved on the phone.
  // Its link goes stale when the song file changes on the server (compression gives it a new one),
  // so always play the server's current version of the song.
  // Songs from "On this computer" (web) get a new blob: link each visit: use the current one.
  const { tracks: localTracks } = useLocalMusic();
  const latest = useMemo(() => new Map([...localTracks, ...songs].map((s) => [s.id, s])), [songs, localTracks]);
  const latestRef = useRef(latest); latestRef.current = latest;
  const fresh = useCallback((t) => {
    const s = latestRef.current.get(t.id);
    return s ? { ...t, ...s } : t;
  }, []);
  const sourceOf = useCallback((t) => playableSource(fresh(t)), [playableSource, fresh]);

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
  const shuffleRef = useRef(shuffleMode); shuffleRef.current = shuffleMode;
  const repeatRef = useRef(repeat); repeatRef.current = repeat;
  const resume = useRef(null); // { qid, position }: restored song, load it paused at this spot

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
    playlist.add(sourceOf(currentTrack));
    native.current.push(currentTrack);
    const at = native.current.length - 1;
    playlist.skipTo(at);
    lastNativeIndex.current = playlist.currentIndex;
    // Restored after a restart: wait at the same spot instead of starting to play.
    const r = resume.current;
    if (r && r.qid === currentTrack.qid) {
      resume.current = null;
      if (r.position > 1) playlist.seekTo(r.position).catch(() => {});
      return;
    }
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
      playlist.add(sourceOf(plannedNext));
      native.current.push(plannedNext);
    }
  }, [currentTrack?.qid, plannedNext?.qid, playlist, truncateAfter, sourceOf]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const meta = metaOf(fresh(currentTrack));
      if (!lockScreenOn.current) {
        playlist.setActiveForLockScreen(true, meta, { showNextTrack: true, showPreviousTrack: true });
        lockScreenOn.current = true;
      } else {
        playlist.updateLockScreenMetadata(meta);
      }
    } catch (e) {
      // Lock screen controls are optional (not available in every environment).
    }
    // A song on the phone: its cover is inside the file. Android's lock screen needs it as a file,
    // so only the playing song's cover is written to the cache (one small image, replaced each time).
    let alive = true;
    if (isLocalCover(currentTrack.artwork)) {
      lockScreenCover(currentTrack.artwork).then((artworkUrl) => {
        if (!alive || !artworkUrl) return;
        try { playlist.updateLockScreenMetadata({ ...metaOf(fresh(currentTrack)), artworkUrl }); } catch (e) { /* optional */ }
      });
    }
    return () => { alive = false; };
  }, [currentTrack?.qid, playlist]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- carry on after a restart ----
  // The queue, the song and the position are saved; the next time the app opens they come back,
  // paused at the same spot (press play to continue).
  const saveResume = useCallback(() => {
    const q = queueRef.current;
    const i = indexRef.current;
    if (i < 0 || !q.length) return;
    const from = Math.max(0, i - 100);
    const strip = ({ qid, ...t }) => t;
    AsyncStorage.setItem(scoped(RESUME_BASE), JSON.stringify({
      queue: q.slice(from, i + 200).map(strip),
      index: i - from,
      position: playlist.currentTime || 0,
      shuffleMode: shuffleRef.current,
      repeat: repeatRef.current,
      context: [...context.current].slice(0, 3000),
    })).catch(() => {});
  }, [playlist]);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(scoped(RESUME_BASE)).then((raw) => {
      if (cancelled || !raw || queueRef.current.length) return; // something is already playing
      const s = JSON.parse(raw);
      if (!s?.queue?.length) return;
      // blob: links (web: computer songs and edits) don't survive a reload: leave those songs out.
      const kept = s.queue.map((t, n) => ({ t, n })).filter(({ t }) => !(typeof t.url === 'string' && t.url.startsWith('blob:')));
      if (!kept.length) return;
      const at = kept.findIndex(({ n }) => n >= (s.index | 0));
      const sameSong = at >= 0 && kept[at].n === (s.index | 0);
      const q = kept.map(({ t }) => toEntry(t));
      const i = Math.min(Math.max(0, at < 0 ? q.length - 1 : at), q.length - 1);
      if (!sameSong) s.position = 0;
      resume.current = { qid: q[i].qid, position: s.position || 0 };
      context.current = new Set(s.context?.length ? s.context : q.map((t) => t.id));
      if (nextShuffle[s.shuffleMode]) setShuffleMode(s.shuffleMode);
      if (nextRepeat[s.repeat]) setRepeat(s.repeat);
      setQueue(q);
      setIndex(i);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (index < 0) return undefined;
    const t = setTimeout(saveResume, 1000);
    return () => clearTimeout(t);
  }, [queue, index, shuffleMode, repeat, saveResume]);

  // ---- listening: stats, play counts, position saving ----
  // Time actually listened to the current entry; seeks don't count.
  const listen = useRef({ qid: null, track: null, seconds: 0, total: 0, counted: false, last: 0, saved: 0 });
  const flushListen = useCallback(() => {
    const l = listen.current;
    if (l.track && l.seconds > 0) addListen(l.track, l.seconds);
    l.seconds = 0;
  }, []);

  useEffect(() => {
    const l = listen.current;
    const entry = native.current[playlist.currentIndex];
    const time = status.currentTime || 0;
    if (!entry) return;
    if (entry.qid !== l.qid) {
      flushListen();
      Object.assign(l, { qid: entry.qid, track: fresh(entry), seconds: 0, total: 0, counted: false, last: time });
      return;
    }
    const step = time - l.last;
    l.last = time;
    if (!status.playing || step <= 0 || step > 3) return;
    l.seconds += step;
    l.total += step;
    const needed = status.duration > 0 ? Math.min(PLAY_SECONDS, status.duration / 2) : PLAY_SECONDS;
    if (!l.counted && l.total >= needed) {
      l.counted = true;
      addListen(l.track, 0, true);
      if (l.track.songId) getDeviceId().then((d) => reportPlay(l.track.songId, d)).catch(() => {});
    }
    if (l.seconds >= 60) flushListen();
    if (Date.now() - l.saved > 15000) { l.saved = Date.now(); saveResume(); }
  }, [status.currentTime, status.playing]); // eslint-disable-line react-hooks/exhaustive-deps

  // Going to the background (or being closed): save everything now.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') { flushListen(); saveResume(); }
    });
    return () => sub.remove();
  }, [flushListen, saveResume]);

  // ---- speed ----
  useEffect(() => {
    try { playlist.playbackRate = speed || 1; } catch (e) { /* ignore */ }
  }, [speed, playlist, currentTrack?.qid]);

  // ---- data saver ----
  // On mobile data, load less ahead: on the phone ~50 s instead of the whole song and the next one
  // (patches/expo-audio+*.patch); in the browser, the next song isn't loaded early (utils/playerExtras*).
  const onMobileData = network?.type === NetworkStateType.CELLULAR;
  useEffect(() => {
    applyDataSaver(playlist, dataSaver, onMobileData);
  }, [dataSaver, onMobileData, playlist]);

  // ---- equalizer (Settings or the player's EQ button) ----
  // Phone: Android's equalizer on the player's audio session. Browser: Web Audio filters.
  const [eqStatus, setEqStatus] = useState({ supported: true, active: false });
  const currentQid = currentTrack?.qid;
  useEffect(() => {
    setEqStatus(applyEq(playlist, eqOn, eqBands));
  }, [eqOn, eqBands, playlist, currentQid]);

  // The browser player makes a new <audio> element per song: route each one through the equalizer.
  useEffect(() => {
    onPlayerStatus(playlist, status.playing);
  }, [playlist, status]);

  // ---- volume: smooth transitions and the sleep timer's fade-out ----
  // Driven by the player's own status updates (twice a second), which keep coming with the screen off.
  const volume = useRef(1);
  const setVolume = useCallback((v) => {
    if (Math.abs(v - volume.current) < 0.01) return;
    volume.current = v;
    try { playlist.volume = v; } catch (e) { /* ignore */ }
  }, [playlist]);

  useEffect(() => {
    if (!status.playing) { setVolume(1); return; }
    let v = 1;
    if (sleepAt) {
      const left = sleepAt - Date.now();
      if (left <= 0) { // works with the screen off, unlike a timer
        playlist.pause();
        setSleepAt(null);
        setVolume(1);
        return;
      }
      v = Math.min(v, left / SLEEP_FADE_MS);
    }
    const dur = status.duration || 0;
    const pos = status.currentTime || 0;
    if (transitions > 0 && dur > transitions * 4 && repeat !== 'one') {
      v = Math.min(v, Math.max(0.05, pos / (transitions / 2)), Math.max(0.05, (dur - pos) / transitions));
    }
    setVolume(Math.max(0, Math.min(1, v)));
  }, [status.currentTime, status.playing, sleepAt, transitions, repeat]); // eslint-disable-line react-hooks/exhaustive-deps

  // A playback error (the network dropped, or the song's file is gone): try the same song again a
  // moment later, from the same spot. If it fails again, move on to the next song. After a few songs
  // in a row fail (e.g. no internet), stop trying; pressing play tries again.
  const failedQid = useRef(null);
  const failStreak = useRef(0);
  const nextRef = useRef(null);
  useEffect(() => {
    if (status.playing) { failedQid.current = null; failStreak.current = 0; }
  }, [status.playing]);
  useEffect(() => {
    let retry = null;
    const sub = playlist.addListener('playlistStatusUpdate', (s) => {
      if (!s?.error) return;
      clearTimeout(retry);
      const entry = native.current[playlist.currentIndex];
      if (entry && failedQid.current !== entry.qid) {
        failedQid.current = entry.qid;
        retry = setTimeout(() => playlist.play(), 2000);
        return;
      }
      failedQid.current = null;
      failStreak.current += 1;
      if (failStreak.current >= 3) return;
      retry = setTimeout(() => {
        nextRef.current?.();
        playlist.play();
      }, 500);
    });
    return () => { clearTimeout(retry); sub.remove(); };
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
    const newQueue = source.map((t) => toEntry(fresh(t)));
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

  const pause = useCallback(() => { try { playlist.pause(); } catch (e) { /* nothing playing */ } }, [playlist]);
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
  nextRef.current = next;

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
    setQueue((q) => [...q.slice(0, index + 1), toEntry(fresh(track), { manual: true }), ...q.slice(index + 1)]);
  }, [index, playTrack]);

  const addToQueue = useCallback((track) => {
    if (index < 0) return playTrack(track);
    setQueue((q) => {
      // Keep "Add to queue" songs together, right after other queued songs.
      let at = index + 1;
      while (at < q.length && q[at].manual) at += 1;
      return smart ? [...q.slice(0, at), toEntry(fresh(track), { manual: true }), ...q.slice(at)] : [...q, toEntry(fresh(track), { manual: true })];
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
    pause,
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
    eqStatus,
  }), [currentTrack, queue, upNext, status.playing, status.isBuffering, status.currentTime, status.duration,
    shuffle, smart, shuffleMode, repeat, sleepAt, sleepAfterTrack, playTrack, togglePlay, pause, next, previous, seekTo,
    playNext, addToQueue, removeFromQueue, jumpTo, clearUpNext, setSleepTimer, eqStatus]);

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside <PlayerProvider>');
  return ctx;
}
