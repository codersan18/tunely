import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, TextInput, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, formatTime } from '../theme';
import { useLocalMusic } from '../context/LocalMusicContext';
import { useCatalog } from '../context/CatalogContext';
import { useLibrary } from '../context/LibraryContext';
import Cover from '../components/Cover';

// "New edit": choose the song to cut, from the songs on the phone or the VibeRoom library.
const TABS = [
  { key: 'phone', title: 'On this phone', icon: 'phone-portrait-outline' },
  { key: 'library', title: 'VibeRoom songs', icon: 'musical-notes-outline' },
];

export default function PickSongScreen({ navigation }) {
  const local = useLocalMusic();
  const { songs } = useCatalog();
  const { playableSource } = useLibrary();
  const [tab, setTab] = useState(local.status === 'ready' && !local.tracks.length ? 'library' : 'phone');
  const [query, setQuery] = useState('');

  const list = useMemo(() => {
    const all = tab === 'phone' ? local.tracks : songs;
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((t) => `${t.title} ${t.artist} ${t.album || ''}`.toLowerCase().includes(q));
  }, [tab, local.tracks, songs, query]);

  const open = (t) => {
    const uri = t.local ? t.url : playableSource(t)?.uri;
    if (!uri) return;
    navigation.replace('Editor', { source: { uri, title: t.title, artist: t.artist } });
  };

  let empty;
  if (tab === 'phone' && local.status !== 'ready') {
    const asking = local.status === 'needs-permission' || local.status === 'denied';
    empty = asking ? (
      <View style={styles.center}>
        <Text style={styles.emptyText}>Allow VibeRoom to see the music saved on your phone.</Text>
        <Pressable onPress={local.requestAccess} style={styles.allow}>
          <Text style={styles.allowText}>{local.status === 'denied' ? 'Open settings' : 'Allow access'}</Text>
        </Pressable>
      </View>
    ) : <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />;
  } else {
    empty = <Text style={styles.emptyText}>{query ? 'No songs match your search.' : 'No songs here yet.'}</Text>;
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Close">
          <Ionicons name="close" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.h1}>Pick a song to edit</Text>
      </View>

      <View style={styles.search}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search songs or artists"
          placeholderTextColor={colors.textDim}
          style={styles.input}
          returnKeyType="search"
        />
        {!!query && (
          <Pressable onPress={() => setQuery('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </Pressable>
        )}
      </View>

      <View style={styles.tabs}>
        {TABS.map((t) => {
          const on = tab === t.key;
          const count = t.key === 'phone' ? local.tracks.length : songs.length;
          return (
            <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.tab, on && styles.tabOn]}>
              <Ionicons name={t.icon} size={15} color={on ? colors.bg : colors.text} />
              <Text style={[styles.tabText, on && { color: colors.bg }]}>{t.title}{count ? ` · ${count}` : ''}</Text>
            </Pressable>
          );
        })}
      </View>

      <FlatList
        data={tab === 'phone' && local.status !== 'ready' ? [] : list}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={15}
        windowSize={7}
        ListEmptyComponent={empty}
        renderItem={({ item: t }) => (
          <Pressable onPress={() => open(t)} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }]}>
            <Cover uri={t.artwork} seed={t.title} style={styles.art} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={styles.title}>{t.title}</Text>
              <Text numberOfLines={1} style={styles.sub}>
                {[t.artist, t.duration ? formatTime(t.duration) : null].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Ionicons name="cut-outline" size={20} color={colors.textMuted} />
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  h1: { color: colors.text, fontSize: 20, fontWeight: '800' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginTop: 10, backgroundColor: colors.surfaceHigh, borderRadius: 8, paddingHorizontal: 12 },
  input: { flex: 1, color: colors.text, fontSize: 15, paddingVertical: 10 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.textDim, paddingHorizontal: 12, paddingVertical: 6 },
  tabOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  tabText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7 },
  art: { width: 48, height: 48, borderRadius: 4 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  sub: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  center: { alignItems: 'center', marginTop: 40, gap: 14, paddingHorizontal: 24 },
  emptyText: { color: colors.textMuted, textAlign: 'center', marginTop: 32, paddingHorizontal: 24 },
  allow: { backgroundColor: colors.accent, borderRadius: 20, paddingHorizontal: 22, paddingVertical: 10 },
  allowText: { color: colors.bg, fontWeight: '800' },
});
