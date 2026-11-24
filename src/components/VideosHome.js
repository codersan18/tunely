import React, { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { useVideos } from '../context/VideosContext';
import { PLACE } from '../utils/videoSource';
import VideoThumb from './VideoThumb';

// Home → Videos: the video folders, like MX Player. Tapping one opens VideoFolder.
export default function VideosHome({ navigation }) {
  const { supported, access, videos, folders, loading, error, start, allow, refresh, pickFolder } = useVideos();
  useEffect(() => { start(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!supported) return <Text style={styles.note}>Videos aren't available here.</Text>;

  if (access !== 'granted') {
    return (
      <View style={styles.ask}>
        <Ionicons name="film-outline" size={44} color={colors.accent} />
        <Text style={styles.askText}>{access === 'denied' ? PLACE.denied : PLACE.intro}</Text>
        <Pressable onPress={allow} style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]} accessibilityRole="button">
          <Text style={styles.buttonText}>{access === 'denied' ? 'Open settings' : PLACE.allow}</Text>
        </Pressable>
      </View>
    );
  }

  if (videos === null || (loading && !videos?.length)) {
    return <View style={styles.ask}><ActivityIndicator color={colors.accent} size="large" /></View>;
  }

  return (
    <View>
      <View style={styles.bar}>
        <Text style={styles.count}>{videos.length} video{videos.length === 1 ? '' : 's'} in {folders.length} folder{folders.length === 1 ? '' : 's'}</Text>
        <View style={{ flexDirection: 'row', gap: 16 }}>
          {pickFolder && (
            <Pressable onPress={pickFolder} hitSlop={8} accessibilityLabel="Choose another folder">
              <Ionicons name="folder-open-outline" size={20} color={colors.textMuted} />
            </Pressable>
          )}
          <Pressable onPress={refresh} hitSlop={8} accessibilityLabel="Look for new videos">
            {loading ? <ActivityIndicator color={colors.textMuted} size="small" /> : <Ionicons name="refresh" size={20} color={colors.textMuted} />}
          </Pressable>
        </View>
      </View>
      {!!error && <Text style={styles.note}>{error}</Text>}
      {!videos.length && <Text style={styles.note}>No videos found.</Text>}
      {folders.map((f) => (
        <Pressable key={f.name} onPress={() => navigation.navigate('VideoFolder', { folder: f.name })}
          style={({ pressed }) => [styles.folder, pressed && { opacity: 0.6 }]} accessibilityRole="button">
          <View>
            <VideoThumb video={f.videos[0]} width={112} height={64} />
            <View style={styles.folderIcon}><Ionicons name="folder" size={14} color="#fff" /></View>
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={styles.folderName}>{f.name}</Text>
            <Text style={styles.folderSub}>{f.videos.length} video{f.videos.length === 1 ? '' : 's'}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  ask: { alignItems: 'center', padding: 32, gap: 16 },
  askText: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  button: { backgroundColor: colors.accent, borderRadius: 24, paddingHorizontal: 24, paddingVertical: 12 },
  buttonText: { color: colors.bg, fontWeight: '800', fontSize: 15 },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 },
  count: { color: colors.textMuted, fontSize: 13 },
  note: { color: colors.textMuted, fontSize: 14, textAlign: 'center', padding: 24 },
  folder: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 8 },
  folderIcon: { position: 'absolute', left: 4, top: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4, padding: 2 },
  folderName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  folderSub: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
});
