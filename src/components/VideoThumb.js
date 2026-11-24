import React, { useEffect, useState } from 'react';
import { View, Image, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { thumbnailFor } from '../utils/videoSource';

/** "1:02:03" / "4:05" */
export function videoTime(seconds = 0) {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0; // unknown length: 0:00
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// A video's picture (loaded once, cached), its length, and how far it was watched.
export default function VideoThumb({ video, width = 128, height = 72, progress = 0 }) {
  const [uri, setUri] = useState(null);
  useEffect(() => {
    let alive = true;
    Promise.resolve(thumbnailFor(video)).then((u) => { if (alive) setUri(u); }).catch(() => {});
    return () => { alive = false; };
  }, [video.uri]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={[styles.box, { width, height }]}>
      {uri ? <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        : <Ionicons name="film-outline" size={Math.round(height * 0.4)} color={colors.textDim} />}
      {!!video.duration && (
        <View style={styles.badge}><Text style={styles.badgeText}>{videoTime(video.duration)}</Text></View>
      )}
      {progress > 0 && (
        <View style={styles.track}><View style={[styles.fill, { width: `${Math.min(100, progress * 100)}%` }]} /></View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 8, overflow: 'hidden', backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', right: 4, bottom: 6, backgroundColor: 'rgba(0,0,0,0.7)', borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  track: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, backgroundColor: 'rgba(255,255,255,0.25)' },
  fill: { height: 3, backgroundColor: colors.accent },
});
