import React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme';
import Cover from './Cover';
import { usePlayer } from '../context/PlayerContext';
import { useLibrary } from '../context/LibraryContext';

export default function MiniPlayer() {
  const navigation = useNavigation();
  const { currentTrack, isPlaying, isBuffering, togglePlay, next, position, duration } = usePlayer();
  const { isLiked, toggleLike } = useLibrary();
  if (!currentTrack) return null;

  const progress = duration ? Math.min(position / duration, 1) : 0;
  const liked = isLiked(currentTrack.id);

  return (
    <Pressable onPress={() => navigation.navigate('Player')} style={styles.wrap}>
      <View style={styles.card}>
        <Cover uri={currentTrack.artwork} seed={currentTrack.title} style={styles.art} />
        <View style={styles.meta}>
          <Text numberOfLines={1} style={styles.title}>{currentTrack.title}</Text>
          <Text numberOfLines={1} style={styles.artist}>{currentTrack.artist}</Text>
        </View>
        <Pressable hitSlop={8} onPress={() => toggleLike(currentTrack)} style={styles.btn}>
          <Ionicons name={liked ? 'heart' : 'heart-outline'} size={22} color={liked ? colors.accent : colors.text} />
        </Pressable>
        <Pressable hitSlop={8} onPress={togglePlay} style={styles.btn}>
          {isBuffering && !isPlaying ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <Ionicons name={isPlaying ? 'pause' : 'play'} size={26} color={colors.text} />
          )}
        </Pressable>
        <Pressable hitSlop={8} onPress={next} style={styles.btn}>
          <Ionicons name="play-skip-forward" size={22} color={colors.text} />
        </Pressable>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${progress * 100}%` }]} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { marginHorizontal: 8, marginBottom: 6, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.accentDark },
  card: { flexDirection: 'row', alignItems: 'center', padding: 8, gap: 10 },
  art: { width: 42, height: 42, borderRadius: 4 },
  meta: { flex: 1 },
  title: { color: colors.text, fontWeight: '700', fontSize: 14 },
  artist: { color: '#CFEDE2', fontSize: 12, marginTop: 2 },
  btn: { paddingHorizontal: 6 },
  track: { height: 2, backgroundColor: 'rgba(255,255,255,0.25)', marginHorizontal: 8 },
  fill: { height: 2, backgroundColor: colors.text },
});
