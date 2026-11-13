import React from 'react';
import { View, Text, Pressable, StyleSheet, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import Cover from '../components/Cover';
import { usePlayer } from '../context/PlayerContext';

function Row({ track, onPress, right, active }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
      <Cover uri={track.artwork} seed={track.title} style={styles.art} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={[styles.title, active && { color: colors.accent }]}>{track.title}</Text>
        <Text numberOfLines={1} style={styles.artist}>{track.artist}</Text>
      </View>
      {right}
    </Pressable>
  );
}

export default function QueueScreen({ navigation }) {
  const { currentTrack, upNext, jumpTo, removeFromQueue, clearUpNext, shuffle } = usePlayer();

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Ionicons name="chevron-down" size={28} color={colors.text} />
        </Pressable>
        <Text style={styles.heading}>Queue</Text>
        <View style={{ width: 28 }} />
      </View>

      <FlatList
        data={upNext}
        keyExtractor={(t) => t.qid}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
        ListHeaderComponent={
          <View>
            <Text style={styles.section}>Now playing</Text>
            {currentTrack ? <Row track={currentTrack} active /> : <Text style={styles.empty}>Nothing playing</Text>}
            <View style={styles.nextHead}>
              <Text style={styles.section}>Next up{shuffle ? ' (shuffle on)' : ''}</Text>
              {!!upNext.length && (
                <Pressable onPress={clearUpNext} hitSlop={8}>
                  <Text style={styles.clear}>Clear</Text>
                </Pressable>
              )}
            </View>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>Use "Play next" or "Add to queue" from any song's menu.</Text>}
        renderItem={({ item }) => (
          <Row
            track={item}
            onPress={() => jumpTo(item.qid)}
            right={
              <Pressable onPress={() => removeFromQueue(item.qid)} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            }
          />
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  heading: { color: colors.text, fontSize: 16, fontWeight: '800' },
  section: { color: colors.text, fontSize: 17, fontWeight: '800', marginTop: 16, marginBottom: 8 },
  nextHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  clear: { color: colors.textMuted, fontWeight: '700', marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  art: { width: 48, height: 48, borderRadius: 4, backgroundColor: colors.surfaceHigh },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  artist: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  empty: { color: colors.textMuted, marginTop: 8 },
});
