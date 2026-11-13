import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, formatTime } from '../theme';
import Cover from '../components/Cover';
import { usePlayer } from '../context/PlayerContext';
import { useLibrary } from '../context/LibraryContext';
import TrackOptions from '../components/TrackOptions';
import SleepTimerSheet from '../components/SleepTimerSheet';
import ShuffleButton from '../components/ShuffleButton';
import { vibeLabel } from '../utils/smartShuffle';

// Everything on the player screen except the artwork and its spacing takes roughly this much height.
const NON_ART_HEIGHT = 300;
const MAX_ART = 520;
const MIN_ART = 160;

// Size the artwork to fit both the width and the height of the current window,
// so it works on small phones, large phones, tablets, foldables and split-screen.
function useArtLayout() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const compact = height < 720;
  const gap = compact ? 18 : 36;
  const usableHeight = height - insets.top - insets.bottom - NON_ART_HEIGHT - gap * 2;
  const size = Math.max(MIN_ART, Math.min(width - 48, usableHeight, MAX_ART));
  return { size, gap };
}

// Tap or drag anywhere on the bar to seek.
function SeekBar({ position, duration, onSeek }) {
  const [width, setWidth] = useState(1);
  const [dragX, setDragX] = useState(null);

  const ratio = dragX != null ? dragX / width : duration ? position / duration : 0;
  const clamp = (x) => Math.max(0, Math.min(x, width));

  return (
    <View>
      <View
        style={styles.barHit}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        // Don't let the surrounding ScrollView steal the drag while seeking.
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => setDragX(clamp(e.nativeEvent.locationX))}
        onResponderMove={(e) => setDragX(clamp(e.nativeEvent.locationX))}
        onResponderRelease={() => {
          if (dragX != null && duration) onSeek((dragX / width) * duration);
          setDragX(null);
        }}
        onResponderTerminate={() => setDragX(null)}
      >
        <View style={styles.bar} pointerEvents="none">
          <View style={[styles.barFill, { width: `${Math.min(ratio, 1) * 100}%` }]} />
        </View>
        <View pointerEvents="none" style={[styles.knob, { left: Math.min(ratio, 1) * width - 6 }]} />
      </View>
      <View style={styles.times}>
        <Text style={styles.time}>{formatTime(ratio * duration)}</Text>
        <Text style={styles.time}>{formatTime(duration)}</Text>
      </View>
    </View>
  );
}

export default function PlayerScreen({ navigation }) {
  const {
    currentTrack, isPlaying, isBuffering, position, duration, togglePlay, next, previous, seekTo,
    smartShuffle, upNext, repeat, cycleRepeat, sleepAt, sleepAfterTrack,
  } = usePlayer();
  const { isLiked, toggleLike, isDownloaded } = useLibrary();
  const [menu, setMenu] = useState(false);
  const [sleepMenu, setSleepMenu] = useState(false);
  const art = useArtLayout();

  // Re-render every 30s so the sleep timer countdown stays fresh.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!sleepAt) return;
    const t = setInterval(() => tick((x) => x + 1), 30000);
    return () => clearInterval(t);
  }, [sleepAt]);

  if (!currentTrack) {
    return (
      <View style={[styles.screen, { alignItems: 'center', justifyContent: 'center' }]}>
        <Text style={{ color: colors.textMuted }}>Nothing playing</Text>
      </View>
    );
  }

  const liked = isLiked(currentTrack.id);

  return (
    <LinearGradient colors={['#2B4A40', '#121214', colors.bg]} style={styles.screen}>
      <SafeAreaView style={styles.inner}>
        {/* Scrolls only if the content still doesn't fit (e.g. very large system font size). */}
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
        <View style={styles.top}>
          <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
            <Ionicons name="chevron-down" size={28} color={colors.text} />
          </Pressable>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.topLabel}>{isDownloaded(currentTrack.id) ? 'PLAYING OFFLINE' : 'NOW PLAYING'}</Text>
            <Text style={styles.topTitle}>{currentTrack.album}</Text>
          </View>
          <Pressable onPress={() => setMenu(true)} hitSlop={10}>
            <Ionicons name="ellipsis-vertical" size={22} color={colors.text} />
          </Pressable>
        </View>

        <Cover
          uri={currentTrack.artwork}
          seed={currentTrack.title}
          style={[styles.art, { width: art.size, height: art.size, marginTop: art.gap }]}
        />

        <View style={[styles.infoRow, { marginTop: art.gap }]}>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={styles.title}>{currentTrack.title}</Text>
            <Text numberOfLines={1} style={styles.artist}>{currentTrack.artist}</Text>
          </View>
          <Pressable onPress={() => toggleLike(currentTrack)} hitSlop={10}>
            <Ionicons name={liked ? 'heart' : 'heart-outline'} size={28} color={liked ? colors.accent : colors.text} />
          </Pressable>
        </View>

        <SeekBar position={position} duration={duration} onSeek={seekTo} />

        <View style={styles.controls}>
          <ShuffleButton size={26} />
          <Pressable onPress={previous} hitSlop={10}>
            <Ionicons name="play-skip-back" size={34} color={colors.text} />
          </Pressable>
          <Pressable onPress={togglePlay} style={styles.playBtn}>
            {isBuffering && !isPlaying ? (
              <ActivityIndicator color={colors.bg} />
            ) : (
              <Ionicons name={isPlaying ? 'pause' : 'play'} size={36} color={colors.bg} style={!isPlaying && { marginLeft: 4 }} />
            )}
          </Pressable>
          <Pressable onPress={next} hitSlop={10}>
            <Ionicons name="play-skip-forward" size={34} color={colors.text} />
          </Pressable>
          <Pressable onPress={cycleRepeat} hitSlop={10}>
            <MaterialCommunityIcons
              name={repeat === 'one' ? 'repeat-once' : 'repeat'}
              size={26}
              color={repeat === 'off' ? colors.text : colors.accent}
            />
          </Pressable>
        </View>

        <View style={styles.footer}>
          <Pressable onPress={() => setSleepMenu(true)} hitSlop={10} style={styles.footerBtn}>
            <Ionicons name={sleepAt || sleepAfterTrack ? 'moon' : 'moon-outline'} size={22}
              color={sleepAt || sleepAfterTrack ? colors.accent : colors.textMuted} />
            {!!sleepAt && (
              <Text style={styles.sleepText}>{Math.max(1, Math.round((sleepAt - Date.now()) / 60000))}m</Text>
            )}
          </Pressable>
          {smartShuffle && upNext[0] && (
            <Pressable onPress={() => navigation.navigate('Queue')} style={styles.smartPill}>
              <Ionicons name="sparkles" size={14} color={colors.accent} />
              <Text numberOfLines={1} style={styles.smartText}>
                Next: {upNext[0].title}{vibeLabel(upNext[0]) ? ` · ${vibeLabel(upNext[0])}` : ''}
              </Text>
            </Pressable>
          )}
          <Pressable onPress={() => navigation.navigate('Queue')} hitSlop={10} style={styles.footerBtn}>
            <Ionicons name="list" size={24} color={colors.textMuted} />
          </Pressable>
        </View>
        </ScrollView>
      </SafeAreaView>
      {menu && <TrackOptions track={currentTrack} visible={menu} onClose={() => setMenu(false)} />}
      <SleepTimerSheet visible={sleepMenu} onClose={() => setSleepMenu(false)} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1 },
  // flexGrow keeps the footer pinned to the bottom when everything fits.
  content: { flexGrow: 1, paddingHorizontal: 24, width: '100%', maxWidth: MAX_ART + 48, alignSelf: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  topLabel: { color: colors.textMuted, fontSize: 11, letterSpacing: 1 },
  topTitle: { color: colors.text, fontWeight: '700', fontSize: 13, marginTop: 2 },
  art: { borderRadius: 8, alignSelf: 'center', backgroundColor: colors.surfaceHigh },
  infoRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 18, gap: 12 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  artist: { color: colors.textMuted, fontSize: 16, marginTop: 4 },
  barHit: { height: 24, justifyContent: 'center' },
  bar: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.25)', overflow: 'hidden' },
  barFill: { height: 4, backgroundColor: colors.text },
  knob: { position: 'absolute', width: 12, height: 12, borderRadius: 6, backgroundColor: colors.text, top: 6 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { color: colors.textMuted, fontSize: 12 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  playBtn: { width: 68, height: 68, borderRadius: 34, backgroundColor: colors.text, alignItems: 'center', justifyContent: 'center' },
  footerBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sleepText: { color: colors.accent, fontSize: 12, fontWeight: '700' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 'auto', marginBottom: 16 },
  smartPill: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: 'rgba(46,230,166,0.12)' },
  smartText: { flex: 1, color: colors.text, fontSize: 12, fontWeight: '600' },
});
