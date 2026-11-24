import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, PanResponder, Platform, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEventListener } from 'expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { useVideos } from '../context/VideosContext';
import { usePlayer } from '../context/PlayerContext';
import Slider from '../components/Slider';
import { videoTime } from '../components/VideoThumb';
import {
  getBrightness, setBrightness, restoreBrightness, getVolume, setVolume, landscape, portrait, CAN_ROTATE, DIM_WITH_OVERLAY,
} from '../utils/videoControls';

// A video player like MX Player:
// - swipe up/down on the left half: brightness; on the right half: volume
// - swipe sideways: seek; double-tap the left/right side: back/forward 10 s; tap: show/hide controls
// - lock (taps and swipes off), speed, fit / fill / stretch, turn the screen
// - carries on where each video was stopped; next/previous in the folder; plays the next one at the end
// - optionally keeps playing in the background (with a notification), like a song

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const FITS = [
  { fit: 'contain', label: 'Fit', icon: 'contract-outline' },
  { fit: 'cover', label: 'Zoom', icon: 'expand-outline' },
  { fit: 'fill', label: 'Stretch', icon: 'resize-outline' },
];
const BG_KEY = 'viberoom:video-background:v1';
const HIDE_MS = 3500;
const DOUBLE_TAP_MS = 280;

export default function VideoPlayerScreen({ route, navigation }) {
  const { folder, index: startIndex = 0 } = route.params || {};
  const { folders, positionOf, savePosition } = useVideos();
  const list = useMemo(() => folders.find((f) => f.name === folder)?.videos || [], [folders, folder]);
  const [index, setIndex] = useState(startIndex);
  const video = list[index];
  const { isPlaying: musicPlaying, pause: pauseMusic } = usePlayer();
  const insets = useSafeAreaInsets();

  const player = useVideoPlayer(video ? { uri: video.uri, metadata: { title: video.filename } } : null, (p) => {
    p.timeUpdateEventInterval = 0.5;
    p.keepScreenOnWhilePlaying = true;
    p.play();
  });

  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(video?.duration || 0);
  const [ready, setReady] = useState(false);
  const [controls, setControls] = useState(true);
  const [locked, setLocked] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [fitIndex, setFitIndex] = useState(0);
  const [rotated, setRotated] = useState(false); // landscape
  const [background, setBackground] = useState(false);
  const [hint, setHint] = useState(null); // { icon, text } while swiping / double-tapping
  const [dim, setDim] = useState(1); // browser "brightness" (DIM_WITH_OVERLAY)
  const [seekPreview, setSeekPreview] = useState(null);
  const layout = useRef({ w: 1, h: 1 });
  const hideTimer = useRef(null);
  const lastSaved = useRef(0);
  const resumed = useRef(false);

  // Music stops when a video starts.
  useEffect(() => { if (musicPlaying) pauseMusic(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Background playing (remembered).
  useEffect(() => { AsyncStorage.getItem(BG_KEY).then((v) => setBackground(v === '1')).catch(() => {}); }, []);
  useEffect(() => {
    if (!player) return;
    try { player.staysActiveInBackground = background; player.showNowPlayingNotification = background; } catch (e) { /* web */ }
  }, [player, background]);

  // Turn the screen for landscape videos; back to upright and normal brightness when closing.
  useEffect(() => {
    if (video && video.width > video.height) { landscape(); setRotated(true); }
  }, [video?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { portrait(); restoreBrightness(); }, []);

  useEffect(() => { if (player) { try { player.playbackRate = speed; } catch (e) { /* not ready */ } } }, [player, speed]);

  // A new video: start from where it was stopped, once it's ready.
  useEffect(() => { resumed.current = false; setReady(false); setTime(0); setDuration(video?.duration || 0); }, [video?.id]);
  useEventListener(player, 'statusChange', ({ status }) => {
    if (status !== 'readyToPlay') return;
    setReady(true);
    if (Number.isFinite(player.duration) && player.duration > 0) setDuration(player.duration);
    if (!resumed.current) { try { player.play(); } catch (e) { /* released */ } }
    if (!resumed.current && video) {
      resumed.current = true;
      positionOf(video.id).then((pos) => {
        const d = (Number.isFinite(player.duration) && player.duration) || video.duration || 0;
        if (pos > 5 && (!d || pos < d - 5)) { player.currentTime = pos; flash('refresh', `Resumed at ${videoTime(pos)}`); }
      });
    }
  });
  useEventListener(player, 'playingChange', ({ isPlaying }) => setPlaying(isPlaying));
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    setTime(currentTime);
    if (video && Math.abs(currentTime - lastSaved.current) > 5) { lastSaved.current = currentTime; savePosition(video.id, currentTime); }
  });
  useEventListener(player, 'playToEnd', () => {
    if (video) savePosition(video.id, 0);
    if (index < list.length - 1) setIndex(index + 1);
  });

  // Remember the place when leaving.
  const saveNow = useCallback(() => {
    if (!video || !player) return;
    try {
      const t = player.currentTime;
      const d = player.duration || duration;
      savePosition(video.id, d && t > d - 5 ? 0 : t);
    } catch (e) { /* released */ }
  }, [video, player, duration, savePosition]);
  useEffect(() => () => saveNow(), [saveNow]);

  // ---- controls showing / hiding ----
  const showControls = useCallback(() => {
    setControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControls(false), HIDE_MS);
  }, []);
  useEffect(() => { showControls(); return () => clearTimeout(hideTimer.current); }, [showControls]);

  const hintTimer = useRef(null);
  const flash = (icon, text) => {
    setHint({ icon, text });
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), 900);
  };

  const togglePlay = () => { if (!player) return; if (player.playing) player.pause(); else player.play(); showControls(); };
  const seekBy = (s) => {
    if (!player) return;
    player.currentTime = Math.max(0, Math.min((player.duration || duration || 0), player.currentTime + s));
    flash(s < 0 ? 'play-back' : 'play-forward', `${s < 0 ? '−' : '+'}${Math.abs(s)} s`);
  };
  const go = (d) => { saveNow(); const n = index + d; if (n >= 0 && n < list.length) setIndex(n); };
  const close = () => { saveNow(); navigation.goBack(); };

  // ---- gestures ----
  const gesture = useRef({});
  const lastTap = useRef({ at: 0, side: null });
  const tapTimer = useRef(null);
  const state = useRef({}); state.current = { locked, duration, player, controls };

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (e, g) => Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8,
    onPanResponderGrant: async (e) => {
      const { locationX: x, locationY: y } = e.nativeEvent;
      gesture.current = { x, y, mode: null, t0: state.current.player?.currentTime || 0 };
      if (!state.current.locked) {
        gesture.current.b0 = DIM_WITH_OVERLAY ? dimRef.current : await getBrightness();
        gesture.current.v0 = getVolume(state.current.player);
      }
    },
    onPanResponderMove: (e, g) => {
      const s = state.current;
      const G = gesture.current;
      if (s.locked) return;
      if (!G.mode && (Math.abs(g.dx) > 12 || Math.abs(g.dy) > 12)) {
        G.mode = Math.abs(g.dx) > Math.abs(g.dy) ? 'seek' : (G.x < layout.current.w / 2 ? 'bright' : 'volume');
      }
      const { w, h } = layout.current;
      if (G.mode === 'seek') {
        const span = Math.min(Math.max(s.duration, 60), 180); // a full swipe moves up to 3 min
        const target = Math.max(0, Math.min(s.duration || 1e9, G.t0 + (g.dx / w) * span));
        G.target = target;
        setSeekPreview({ target, delta: target - G.t0 });
      } else if (G.mode === 'bright') {
        const v = Math.max(0.01, Math.min(1, (G.b0 ?? 0.5) - g.dy / (h * 0.7)));
        if (DIM_WITH_OVERLAY) { dimRef.current = v; setDim(v); } else setBrightness(v);
        setHint({ icon: 'sunny', text: `${Math.round(v * 100)}%` });
      } else if (G.mode === 'volume') {
        const v = setVolume(s.player, (G.v0 ?? 0.5) - g.dy / (h * 0.7));
        setHint({ icon: v === 0 ? 'volume-mute' : 'volume-high', text: `${Math.round(v * 100)}%` });
      }
    },
    onPanResponderRelease: (e) => {
      const s = state.current;
      const G = gesture.current;
      if (G.mode === 'seek' && s.player && G.target != null) { s.player.currentTime = G.target; }
      if (G.mode) { setSeekPreview(null); setTimeout(() => setHint(null), 600); return; }
      // A tap: double-tap the sides to skip, single tap shows/hides the controls.
      const x = e.nativeEvent.locationX;
      const side = x < layout.current.w / 3 ? 'left' : x > (layout.current.w * 2) / 3 ? 'right' : 'middle';
      const now = Date.now();
      if (!s.locked && now - lastTap.current.at < DOUBLE_TAP_MS && side === lastTap.current.side) {
        clearTimeout(tapTimer.current);
        lastTap.current = { at: 0, side: null };
        if (side === 'left') seekByRef.current(-10);
        else if (side === 'right') seekByRef.current(10);
        else togglePlayRef.current();
        return;
      }
      lastTap.current = { at: now, side };
      clearTimeout(tapTimer.current);
      tapTimer.current = setTimeout(() => {
        if (s.controls) setControls(false); else showControlsRef.current();
      }, DOUBLE_TAP_MS);
    },
    onPanResponderTerminationRequest: () => false,
  }), []);
  const dimRef = useRef(1);
  const seekByRef = useRef(seekBy); seekByRef.current = seekBy;
  const togglePlayRef = useRef(togglePlay); togglePlayRef.current = togglePlay;
  const showControlsRef = useRef(showControls); showControlsRef.current = showControls;

  // Keyboard on the web: space, arrows, f (fit).
  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const onKey = (e) => {
      if (e.key === ' ') { e.preventDefault(); togglePlayRef.current(); }
      else if (e.key === 'ArrowLeft') seekByRef.current(-10);
      else if (e.key === 'ArrowRight') seekByRef.current(10);
      else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const v = setVolume(player, getVolume(player) + (e.key === 'ArrowUp' ? 0.1 : -0.1));
        flash('volume-high', `${Math.round(v * 100)}%`);
      } else if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  if (!video) {
    return (
      <View style={[styles.screen, styles.center]}>
        <Text style={styles.msg}>This video isn't available any more.</Text>
        <Pressable onPress={() => navigation.goBack()} style={styles.pill}><Text style={styles.pillText}>Back</Text></Pressable>
      </View>
    );
  }

  const fit = FITS[fitIndex];
  const toggleBackground = () => {
    const next = !background;
    setBackground(next);
    AsyncStorage.setItem(BG_KEY, next ? '1' : '0').catch(() => {});
    flash('headset', next ? 'Keeps playing in the background' : 'Pauses in the background');
    showControls();
  };

  return (
    <View style={styles.screen} onLayout={(e) => { layout.current = { w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height }; }}>
      <StatusBar hidden />
      <View style={StyleSheet.absoluteFill}>
        <VideoView player={player} style={styles.fill} contentFit={fit.fit} nativeControls={false}
          allowsPictureInPicture startsPictureInPictureAutomatically={background} />
      </View>
      {DIM_WITH_OVERLAY && dim < 1 && <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${0.85 * (1 - dim)})` }]} />}

      {/* gestures */}
      <View style={StyleSheet.absoluteFill} {...pan.panHandlers} />

      {!ready && <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}><ActivityIndicator color="#fff" size="large" /></View>}

      {(hint || seekPreview) && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
          <View style={styles.hint}>
            {seekPreview ? (
              <>
                <Text style={styles.hintBig}>{videoTime(seekPreview.target)}</Text>
                <Text style={styles.hintSmall}>{seekPreview.delta < 0 ? '−' : '+'}{videoTime(Math.abs(seekPreview.delta))}</Text>
              </>
            ) : (
              <>
                <Ionicons name={hint.icon} size={30} color="#fff" />
                <Text style={styles.hintSmall}>{hint.text}</Text>
              </>
            )}
          </View>
        </View>
      )}

      {locked ? (
        controls && (
          <Pressable onPress={() => { setLocked(false); showControls(); }} style={[styles.lock, { top: insets.top + 16, left: insets.left + 16 }]}
            accessibilityLabel="Unlock">
            <Ionicons name="lock-closed" size={22} color="#fff" />
          </Pressable>
        )
      ) : controls && (
        <>
          {/* top */}
          <View style={[styles.topBar, { paddingTop: insets.top + 8, paddingLeft: insets.left + 12, paddingRight: insets.right + 12 }]}>
            <Pressable onPress={close} hitSlop={10} accessibilityLabel="Close"><Ionicons name="chevron-back" size={28} color="#fff" /></Pressable>
            <Text numberOfLines={1} style={styles.title}>{video.filename}</Text>
            <Pressable onPress={toggleBackground} hitSlop={10} accessibilityLabel="Play in the background">
              <Ionicons name={background ? 'headset' : 'headset-outline'} size={22} color={background ? colors.accent : '#fff'} />
            </Pressable>
            <Pressable onPress={() => { setLocked(true); flash('lock-closed', 'Locked: tap, then the lock to unlock'); }} hitSlop={10} accessibilityLabel="Lock">
              <Ionicons name="lock-open-outline" size={22} color="#fff" />
            </Pressable>
          </View>

          {/* middle */}
          <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, styles.center]}>
            <View style={styles.middle}>
              <Pressable onPress={() => go(-1)} disabled={index === 0} hitSlop={10} accessibilityLabel="Previous video">
                <Ionicons name="play-skip-back" size={30} color={index === 0 ? 'rgba(255,255,255,0.3)' : '#fff'} />
              </Pressable>
              <Pressable onPress={togglePlay} style={styles.playButton} accessibilityLabel={playing ? 'Pause' : 'Play'}>
                <Ionicons name={playing ? 'pause' : 'play'} size={40} color="#fff" style={!playing && { marginLeft: 4 }} />
              </Pressable>
              <Pressable onPress={() => go(1)} disabled={index >= list.length - 1} hitSlop={10} accessibilityLabel="Next video">
                <Ionicons name="play-skip-forward" size={30} color={index >= list.length - 1 ? 'rgba(255,255,255,0.3)' : '#fff'} />
              </Pressable>
            </View>
          </View>

          {/* bottom */}
          <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 10, paddingLeft: insets.left + 16, paddingRight: insets.right + 16 }]}>
            <View style={styles.seekRow}>
              <Text style={styles.time}>{videoTime(time)}</Text>
              <Slider value={Math.min(time, duration || time)} min={0} max={Math.max(duration, 1)} step={1}
                onChange={(v) => { if (player) { player.currentTime = v; setTime(v); } showControls(); }} style={{ flex: 1 }} />
              <Text style={styles.time}>{videoTime(duration)}</Text>
            </View>
            <View style={styles.tools}>
              <Pressable onPress={() => { const i = (SPEEDS.indexOf(speed) + 1) % SPEEDS.length; setSpeed(SPEEDS[i]); flash('speedometer', `${SPEEDS[i]}×`); showControls(); }}
                style={styles.tool} accessibilityLabel="Playback speed">
                <Ionicons name="speedometer-outline" size={18} color="#fff" />
                <Text style={styles.toolText}>{speed}×</Text>
              </Pressable>
              <Pressable onPress={() => { const i = (fitIndex + 1) % FITS.length; setFitIndex(i); flash(FITS[i].icon, FITS[i].label); showControls(); }}
                style={styles.tool} accessibilityLabel="Fit, zoom or stretch">
                <Ionicons name={fit.icon} size={18} color="#fff" />
                <Text style={styles.toolText}>{fit.label}</Text>
              </Pressable>
              {CAN_ROTATE && (
                <Pressable onPress={() => { if (rotated) portrait(); else landscape(); setRotated(!rotated); showControls(); }}
                  style={styles.tool} accessibilityLabel="Turn the screen">
                  <Ionicons name="phone-landscape-outline" size={18} color="#fff" />
                  <Text style={styles.toolText}>Rotate</Text>
                </Pressable>
              )}
              <Text style={styles.count}>{index + 1} / {list.length}</Text>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1, width: '100%', height: '100%' },
  center: { alignItems: 'center', justifyContent: 'center' },
  msg: { color: '#fff', fontSize: 15, marginBottom: 16 },
  pill: { backgroundColor: colors.accent, borderRadius: 20, paddingHorizontal: 20, paddingVertical: 10 },
  pillText: { color: colors.bg, fontWeight: '800' },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', gap: 16, paddingBottom: 12, backgroundColor: 'rgba(0,0,0,0.45)' },
  title: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '700' },
  middle: { flexDirection: 'row', alignItems: 'center', gap: 44 },
  playButton: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  bottomBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 10, backgroundColor: 'rgba(0,0,0,0.45)' },
  seekRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  time: { color: '#fff', fontSize: 12, fontWeight: '600', minWidth: 44, textAlign: 'center' },
  tools: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.14)' },
  toolText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  count: { marginLeft: 'auto', color: 'rgba(255,255,255,0.7)', fontSize: 12 },
  hint: { backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 14, paddingHorizontal: 22, paddingVertical: 14, alignItems: 'center', gap: 4, minWidth: 110 },
  hintBig: { color: '#fff', fontSize: 26, fontWeight: '800' },
  hintSmall: { color: '#fff', fontSize: 14, fontWeight: '700' },
  lock: { position: 'absolute', width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
});
