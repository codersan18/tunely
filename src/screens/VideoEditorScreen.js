import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, TextInput, Switch, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useEventListener } from 'expo';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { useVideos } from '../context/VideosContext';
import RangeSlider from '../components/RangeSlider';
import { videoTime } from '../components/VideoThumb';
import AudioEditor, { VIDEO_TOOLS_SUPPORTED } from '../../modules/audio-editor';
import { notify } from '../utils/platform';

// Video editor: keep a part (trim) or cut a part out of the middle, remove the sound, turn the
// video. Saved as a new video in Movies/VibeRoom; the original stays as it is. The video isn't
// re-encoded (fast, same quality), so a part starts at the key frame at or just before its start.

const ROTATIONS = [0, 90, 180, 270];

export default function VideoEditorScreen({ route, navigation }) {
  const { id } = route.params || {};
  const { videos, refresh } = useVideos();
  const video = useMemo(() => (videos || []).find((v) => v.id === id), [videos, id]);
  const player = useVideoPlayer(video ? { uri: video.uri } : null, (p) => { p.timeUpdateEventInterval = 0.25; });

  const [duration, setDuration] = useState(video?.duration || 0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(video?.duration || 0);
  const [mode, setMode] = useState('keep'); // keep | cut
  const [mute, setMute] = useState(false);
  const [rotate, setRotate] = useState(0);
  const [name, setName] = useState(video ? `${video.filename.replace(/\.[^.]+$/, '')} (edit)` : '');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState(null); // null | 0..1
  const [error, setError] = useState('');

  useEventListener(player, 'statusChange', ({ status }) => {
    if (status === 'readyToPlay' && Number.isFinite(player.duration) && player.duration > 0 && !duration) { setDuration(player.duration); setEnd(player.duration); }
  });
  useEventListener(player, 'timeUpdate', ({ currentTime }) => {
    setTime(currentTime);
    // Previewing "keep": stop at the end of the part.
    if (mode === 'keep' && player.playing && currentTime >= end) { player.pause(); player.currentTime = start; }
    // Previewing "cut out": jump over the removed part.
    if (mode === 'cut' && player.playing && currentTime >= start && currentTime < end) player.currentTime = end;
  });
  useEventListener(player, 'playingChange', ({ isPlaying }) => setPlaying(isPlaying));
  useEffect(() => { if (player) player.muted = mute; }, [player, mute]);

  useEffect(() => {
    const sub = AudioEditor?.addListener?.('onProgress', (e) => setSaving((s) => (s == null ? s : e.progress)));
    return () => sub?.remove?.();
  }, []);

  if (!video) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Text style={styles.msg}>This video isn't available any more.</Text>
        <Pressable onPress={() => navigation.goBack()} style={styles.save}><Text style={styles.saveText}>Back</Text></Pressable>
      </SafeAreaView>
    );
  }
  if (!VIDEO_TOOLS_SUPPORTED) {
    return (
      <SafeAreaView style={[styles.screen, styles.center, { padding: 24 }]}>
        <Ionicons name="phone-portrait-outline" size={40} color={colors.accent} />
        <Text style={styles.msg}>Video editing works in the VibeRoom phone app (with the newest version installed).</Text>
        <Pressable onPress={() => navigation.goBack()} style={styles.save}><Text style={styles.saveText}>Back</Text></Pressable>
      </SafeAreaView>
    );
  }

  const kept = mode === 'keep' ? end - start : duration - (end - start);
  const preview = () => {
    if (!player) return;
    if (player.playing) { player.pause(); return; }
    player.currentTime = mode === 'keep' ? start : 0;
    player.play();
  };

  const save = async () => {
    if (saving != null) return;
    const segments = (mode === 'keep' ? [[start, end]] : [[0, start], [end, duration]])
      .filter(([s, e]) => e - s >= 0.3)
      .map(([s, e]) => ({ startMs: Math.round(s * 1000), endMs: Math.round(e * 1000) }));
    if (!segments.length) { setError('Nothing would be left. Choose a smaller part to cut out.'); return; }
    setError('');
    player?.pause();
    setSaving(0);
    try {
      const out = await AudioEditor.editVideo(video.uri, { segments, mute, rotate, name: name.trim() || 'VibeRoom video' });
      setSaving(null);
      refresh();
      notify('Saved', `"${out.name}" is in Movies/VibeRoom (${videoTime(out.durationMs / 1000)}).`);
      navigation.goBack();
    } catch (e) {
      setSaving(null);
      setError(e.code === 'ERR_CANCELLED' ? '' : (e.message || 'Couldn\'t save the video.'));
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable onPress={() => { if (saving != null) AudioEditor.cancel(); navigation.goBack(); }} hitSlop={10} accessibilityLabel="Close">
          <Ionicons name="close" size={28} color={colors.text} />
        </Pressable>
        <Text style={styles.h1}>Edit video</Text>
        <Pressable onPress={save} disabled={saving != null} style={({ pressed }) => [styles.save, (pressed || saving != null) && { opacity: 0.7 }]}>
          {saving != null ? <ActivityIndicator color={colors.bg} size="small" /> : <Text style={styles.saveText}>Save</Text>}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Pressable onPress={preview} style={styles.preview} accessibilityLabel={playing ? 'Pause preview' : 'Play preview'}>
          <View style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${rotate}deg` }] }]}>
            <VideoView player={player} style={{ flex: 1, width: '100%', height: '100%' }} contentFit="contain" nativeControls={false} />
          </View>
          {!playing && <View style={styles.playBadge}><Ionicons name="play" size={30} color="#fff" style={{ marginLeft: 3 }} /></View>}
        </Pressable>

        <View style={styles.modes}>
          {[['keep', 'Keep part', 'cut-outline'], ['cut', 'Cut out part', 'remove-circle-outline']].map(([m, label, icon]) => (
            <Pressable key={m} onPress={() => setMode(m)} style={[styles.mode, mode === m && styles.modeOn]}>
              <Ionicons name={icon} size={16} color={mode === m ? colors.bg : colors.text} />
              <Text style={[styles.modeText, mode === m && { color: colors.bg }]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <RangeSlider duration={duration || 1} start={start} end={end || duration}
          onChange={(s, e) => { setStart(s); setEnd(e); }} onSeek={(t) => { if (player) player.currentTime = t; }} cut={mode === 'cut'} />
        <View style={styles.times}>
          <Text style={styles.time}>Start {videoTime(start)}</Text>
          <Text style={styles.timeNow}>{videoTime(time)}</Text>
          <Text style={styles.time}>End {videoTime(end)}</Text>
        </View>
        <Text style={styles.note}>
          {mode === 'keep' ? 'Keeps the part between the handles' : 'Removes the red part and joins the rest'} · new video {videoTime(kept)}
        </Text>

        <View style={styles.row}>
          <Ionicons name="volume-mute-outline" size={20} color={colors.accent} />
          <Text style={styles.rowText}>Remove sound</Text>
          <Switch value={mute} onValueChange={setMute} trackColor={{ true: colors.accentDark, false: colors.surfaceHigh }} thumbColor={mute ? colors.accent : colors.textMuted} />
        </View>
        <Pressable onPress={() => setRotate(ROTATIONS[(ROTATIONS.indexOf(rotate) + 1) % 4])} style={styles.row} accessibilityRole="button">
          <Ionicons name="refresh-outline" size={20} color={colors.accent} />
          <Text style={styles.rowText}>Rotate</Text>
          <Text style={styles.rowValue}>{rotate}°</Text>
        </Pressable>

        <Text style={styles.label}>Name</Text>
        <TextInput value={name} onChangeText={setName} style={styles.input} maxLength={80} placeholder="Name" placeholderTextColor={colors.textDim} />

        {saving != null && (
          <View style={styles.progress}>
            <View style={[styles.progressFill, { width: `${Math.round(saving * 100)}%` }]} />
            <Text style={styles.progressText}>Saving… {Math.round(saving * 100)}%</Text>
          </View>
        )}
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Text style={styles.note}>Saved as a new video in Movies/VibeRoom. The original isn't changed.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  msg: { color: colors.text, fontSize: 15, textAlign: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 10 },
  h1: { flex: 1, color: colors.text, fontSize: 20, fontWeight: '800' },
  save: { backgroundColor: colors.accent, borderRadius: 18, paddingHorizontal: 20, paddingVertical: 8, minWidth: 76, alignItems: 'center' },
  saveText: { color: colors.bg, fontWeight: '800', fontSize: 15 },
  body: { padding: 16, paddingBottom: 48, gap: 12 },
  preview: { aspectRatio: 16 / 9, backgroundColor: '#000', borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  playBadge: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  modes: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  mode: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: colors.surfaceHigh },
  modeOn: { backgroundColor: colors.accent },
  modeText: { color: colors.text, fontWeight: '700', fontSize: 14 },
  times: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  time: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  timeNow: { color: colors.text, fontSize: 13, fontWeight: '800' },
  note: { color: colors.textMuted, fontSize: 12, textAlign: 'center', lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  rowText: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  rowValue: { color: colors.textMuted, fontSize: 15, fontWeight: '700' },
  label: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  input: { backgroundColor: colors.surfaceHigh, color: colors.text, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  progress: { height: 32, borderRadius: 8, backgroundColor: colors.surfaceHigh, overflow: 'hidden', justifyContent: 'center' },
  progressFill: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.accentDark },
  progressText: { color: colors.text, textAlign: 'center', fontWeight: '700', fontSize: 13 },
  error: { color: colors.danger, fontSize: 13, textAlign: 'center' },
});
