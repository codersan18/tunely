import React, { useCallback, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { colors } from '../theme';
import AudioEditor from '../../modules/audio-editor';
import Sheet, { SheetItem } from '../components/Sheet';
import { usePlayer } from '../context/PlayerContext';
import { SOUND_KINDS, setPhoneSound } from '../utils/phoneSounds';
import { toast } from '../utils/platform';

// The sounds made with the editor, saved on the phone (Ringtones/Alarms/Notifications/Music → VibeRoom).
const KIND_ICON = { ringtone: 'call', alarm: 'alarm', notification: 'chatbubble-ellipses', music: 'musical-note' };
const seconds = (ms) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const asTrack = (e) => ({
  id: `edit:${e.id}`, title: e.name, artist: 'Your edit', url: e.uri, local: true, duration: e.durationMs / 1000, artwork: null,
});

export default function EditsScreen({ navigation }) {
  const { playTrack, currentTrack, isPlaying } = usePlayer();
  const [edits, setEdits] = useState(null);
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    AudioEditor.listEdits().then(setEdits).catch(() => setEdits([]));
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const pickFile = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: false });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      navigation.navigate('Editor', { source: { uri: a.uri, title: (a.name || 'Sound').replace(/\.[^.]+$/, '') } });
    } catch (e) { toast("Couldn't open that file"); }
  };

  const remove = (e) => {
    Alert.alert('Delete this sound?', `"${e.name}" will be deleted from the phone.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: () => AudioEditor.deleteEdit(e.uri).then(() => { toast('Deleted'); load(); }).catch((err) => toast(err.message)),
      },
    ]);
  };

  const list = edits || [];
  const tracks = list.map(asTrack);

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <View style={styles.top}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Pressable>
        <Text style={styles.h1}>Ringtones & edits</Text>
      </View>

      <FlatList
        data={list}
        keyExtractor={(e) => e.id}
        contentContainerStyle={styles.list}
        onRefresh={load}
        refreshing={false}
        ListHeaderComponent={(
          <View>
            <Pressable onPress={pickFile} style={({ pressed }) => [styles.newRow, pressed && { opacity: 0.6 }]}>
              <View style={[styles.icon, { backgroundColor: colors.accent }]}><Ionicons name="cut" size={24} color={colors.bg} /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>New edit</Text>
                <Text style={styles.sub}>Pick any audio file on the phone</Text>
              </View>
            </Pressable>
            <Text style={styles.tip}>Or open any song's ••• menu → Cut / make ringtone.</Text>
          </View>
        )}
        ListEmptyComponent={edits === null
          ? <ActivityIndicator color={colors.accent} style={{ marginTop: 32 }} />
          : <Text style={styles.empty}>Nothing yet. Sounds you save in the editor show up here.</Text>}
        renderItem={({ item: e, index }) => {
          const playing = currentTrack?.id === `edit:${e.id}` && isPlaying;
          const badges = [e.isRingtone && 'Ringtone', e.isAlarm && 'Alarm', e.isNotification && 'Notification'].filter(Boolean);
          return (
            <Pressable onPress={() => playTrack(tracks[index], tracks)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
              <View style={styles.icon}><Ionicons name={KIND_ICON[e.kind]} size={22} color={playing ? colors.accent : colors.text} /></View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={[styles.title, playing && { color: colors.accent }]}>{e.name}</Text>
                <Text numberOfLines={1} style={styles.sub}>{seconds(e.durationMs)} · {e.folder}</Text>
                {!!badges.length && (
                  <View style={styles.badges}>
                    {badges.map((b) => <Text key={b} style={styles.badge}>Your {b.toLowerCase()}</Text>)}
                  </View>
                )}
              </View>
              <Pressable onPress={() => setOpen(e)} hitSlop={10} style={{ padding: 4 }} accessibilityLabel="More options">
                <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
              </Pressable>
            </Pressable>
          );
        }}
      />

      <Sheet visible={!!open} onClose={() => setOpen(null)}>
        {!!open && (
          <>
            <Text numberOfLines={1} style={styles.sheetTitle}>{open.name}</Text>
            {Object.entries(SOUND_KINDS).map(([k, o]) => (
              <SheetItem key={k} icon={o.icon} label={o.set}
                onPress={() => { const e = open; setOpen(null); setPhoneSound(e.uri, k, load); }} />
            ))}
            <SheetItem icon="cut-outline" label="Edit again"
              onPress={() => { const e = open; setOpen(null); navigation.navigate('Editor', { source: { uri: e.uri, title: e.name } }); }} />
            <SheetItem icon="trash-outline" label="Delete" color={colors.danger}
              onPress={() => { const e = open; setOpen(null); remove(e); }} />
          </>
        )}
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  h1: { color: colors.text, fontSize: 22, fontWeight: '800' },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  newRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  tip: { color: colors.textDim, fontSize: 12, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  icon: { width: 52, height: 52, borderRadius: 8, backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  sub: { color: colors.textMuted, fontSize: 13, marginTop: 3 },
  badges: { flexDirection: 'row', gap: 6, marginTop: 5 },
  badge: { color: colors.bg, backgroundColor: colors.accent, fontSize: 11, fontWeight: '800', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2, overflow: 'hidden' },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 32, paddingHorizontal: 24 },
  sheetTitle: { color: colors.text, fontSize: 16, fontWeight: '800', paddingHorizontal: 20, paddingBottom: 6 },
});
