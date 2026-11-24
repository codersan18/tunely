import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { useVideos } from '../context/VideosContext';
import VideoThumb, { videoTime } from '../components/VideoThumb';
import Sheet, { SheetItem } from '../components/Sheet';
import { EDITOR_SUPPORTED, VIDEO_TOOLS_SUPPORTED } from '../../modules/audio-editor';

// One video folder: its videos (newest first), how far each was watched, and per video: play,
// edit (trim / cut / mute / rotate), or turn its sound into a song (the audio editor).
export default function VideoFolderScreen({ route, navigation }) {
  const { folder } = route.params;
  const { folders, positionOf } = useVideos();
  const list = folders.find((f) => f.name === folder)?.videos || [];
  const [progress, setProgress] = useState({});
  const [open, setOpen] = useState(null);

  // How far each was watched (refreshed when coming back from the player).
  useFocusEffect(useCallback(() => {
    let alive = true;
    (async () => {
      const p = {};
      for (const v of list) {
        const pos = await positionOf(v.id);
        if (pos && v.duration) p[v.id] = pos / v.duration;
      }
      if (alive) setProgress(p);
    })();
    return () => { alive = false; };
  }, [list.length, positionOf])); // eslint-disable-line react-hooks/exhaustive-deps

  const play = (i) => navigation.navigate('VideoPlayer', { folder, index: i });

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <View style={styles.top}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Pressable>
        <Text numberOfLines={1} style={styles.h1}>{folder}</Text>
      </View>
      <FlatList
        data={list}
        keyExtractor={(v) => v.id}
        contentContainerStyle={{ paddingBottom: 140 }}
        ListEmptyComponent={<Text style={styles.note}>No videos here.</Text>}
        renderItem={({ item, index }) => (
          <Pressable onPress={() => play(index)} onLongPress={() => setOpen(item)}
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]} accessibilityRole="button" accessibilityLabel={`Play ${item.filename}`}>
            <VideoThumb video={item} width={128} height={72} progress={progress[item.id] || 0} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={2} style={styles.name}>{item.filename}</Text>
              <Text style={styles.sub}>
                {item.duration ? videoTime(item.duration) : ''}{item.width && item.height ? `  ·  ${Math.min(item.width, item.height)}p` : ''}
              </Text>
            </View>
            <Pressable onPress={() => setOpen(item)} hitSlop={10} accessibilityLabel={`More for ${item.filename}`}>
              <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
            </Pressable>
          </Pressable>
        )}
      />
      <Sheet visible={!!open} onClose={() => setOpen(null)}>
        {!!open && (
          <>
            <Text numberOfLines={1} style={styles.sheetTitle}>{open.filename}</Text>
            <SheetItem icon="play" label="Play" onPress={() => { const i = list.indexOf(open); setOpen(null); play(i); }} />
            {VIDEO_TOOLS_SUPPORTED && (
              <SheetItem icon="cut-outline" label="Edit video" onPress={() => { const v = open; setOpen(null); navigation.navigate('VideoEditor', { id: v.id }); }} />
            )}
            {EDITOR_SUPPORTED && (
              <SheetItem icon="musical-notes-outline" label="Convert to audio" onPress={() => {
                const v = open;
                setOpen(null);
                navigation.navigate('Editor', { source: { uri: v.uri, title: v.filename.replace(/\.[^.]+$/, '') } });
              }} />
            )}
          </>
        )}
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8 },
  h1: { flex: 1, color: colors.text, fontSize: 22, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 8 },
  name: { color: colors.text, fontSize: 14, fontWeight: '600' },
  sub: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  note: { color: colors.textMuted, textAlign: 'center', padding: 24 },
  sheetTitle: { color: colors.text, fontSize: 16, fontWeight: '800', paddingHorizontal: 20, paddingBottom: 8 },
});
