import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import Cover from './Cover';
import { usePlayer } from '../context/PlayerContext';
import { useLibrary } from '../context/LibraryContext';
import TrackOptions from './TrackOptions';

export default function TrackRow({ track, list, index, playlistId }) {
  const { playTrack, currentTrack, isPlaying } = usePlayer();
  const { isLiked, toggleLike, isDownloaded } = useLibrary();
  const [menu, setMenu] = useState(false);
  const active = currentTrack?.id === track.id;
  const liked = isLiked(track.id);

  return (
    <>
      <Pressable
        onPress={() => playTrack(track, list)}
        onLongPress={() => setMenu(true)}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}
      >
        {typeof index === 'number' && (
          <View style={styles.indexBox}>
            {active && isPlaying ? (
              <Ionicons name="stats-chart" size={14} color={colors.accent} />
            ) : (
              <Text style={[styles.index, active && { color: colors.accent }]}>{index + 1}</Text>
            )}
          </View>
        )}
        <Cover uri={track.artwork} seed={track.title} style={styles.art} />
        <View style={styles.meta}>
          <Text numberOfLines={1} style={[styles.title, active && { color: colors.accent }]}>{track.title}</Text>
          <View style={styles.sub}>
            {isDownloaded(track.id) && <Ionicons name="arrow-down-circle" size={13} color={colors.accent} />}
            <Text numberOfLines={1} style={styles.artist}>{track.artist}</Text>
          </View>
        </View>
        <Pressable hitSlop={10} onPress={() => toggleLike(track)}>
          <Ionicons name={liked ? 'heart' : 'heart-outline'} size={22} color={liked ? colors.accent : colors.textMuted} />
        </Pressable>
        <Pressable hitSlop={10} onPress={() => setMenu(true)}>
          <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
        </Pressable>
      </Pressable>
      {menu && <TrackOptions track={track} visible={menu} onClose={() => setMenu(false)} playlistId={playlistId} />}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 12 },
  indexBox: { width: 20, alignItems: 'center' },
  index: { color: colors.textMuted, fontSize: 14 },
  art: { width: 50, height: 50, borderRadius: 4, backgroundColor: colors.surfaceHigh },
  meta: { flex: 1 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  sub: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  artist: { color: colors.textMuted, fontSize: 13, flexShrink: 1 },
});
