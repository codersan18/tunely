import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { useLocalMusic, CATEGORIES, PLACE } from '../context/LocalMusicContext';
import { usePlayer } from '../context/PlayerContext';
import TrackRow from '../components/TrackRow';
import Cover from '../components/Cover';
import ShuffleButton from '../components/ShuffleButton';

// "On this phone": songs saved on the phone, in sections (Songs, WhatsApp audio, Others) and
// grouped by artist, album or folder. Everything plays straight from the phone.

const GROUPS = [
  { key: 'artists', title: 'Artists', icon: 'person', round: true },
  { key: 'albums', title: 'Albums', icon: 'disc' },
  { key: 'folders', title: 'Folders', icon: 'folder' },
];

export default function LocalMusicScreen({ navigation }) {
  const local = useLocalMusic();
  const { playTrack, currentTrack, isPlaying, togglePlay, shuffleMode } = usePlayer();
  const [tab, setTab] = useState('songs');
  const { byCategory } = local.groups;

  const category = CATEGORIES.find((c) => c.key === tab);
  const group = GROUPS.find((g) => g.key === tab);
  const list = category ? byCategory[tab] : [];
  const playingThis = isPlaying && list.some((t) => t.id === currentTrack?.id);

  const onPlay = () => {
    if (!list.length) return;
    if (list.some((t) => t.id === currentTrack?.id)) togglePlay();
    else playTrack(shuffleMode !== 'off' ? list[Math.floor(Math.random() * list.length)] : list[0], list);
  };

  const openGroup = (name) => navigation.navigate('Playlist', { playlistId: `device:${tab.slice(0, -1)}:${name}` });

  const top = (
    <View style={styles.top}>
      <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
        <Ionicons name="chevron-back" size={28} color={colors.text} />
      </Pressable>
      <Text style={[styles.h1, { flex: 1 }]}>{PLACE.title}</Text>
      {!!local.changeFolder && local.status === 'ready' && (
        <Pressable onPress={local.changeFolder} hitSlop={8} style={styles.folderBtn}>
          <Ionicons name="folder-open-outline" size={16} color={colors.text} />
          <Text style={styles.folderText}>Change folder</Text>
        </Pressable>
      )}
    </View>
  );

  // Before the list: ask for access, or say what's happening.
  if (local.status !== 'ready') {
    const denied = local.status === 'denied';
    const asking = local.status === 'needs-permission' || denied;
    return (
      <SafeAreaView edges={['top']} style={styles.screen}>
        {top}
        <View style={styles.center}>
          <LinearGradient colors={['#5C3A1F', '#F2B880']} style={styles.bigIcon}>
            <Ionicons name={PLACE.icon} size={44} color="#fff" />
          </LinearGradient>
          {asking ? (
            <>
              <Text style={styles.msg}>
                {denied ? PLACE.denied : PLACE.intro}
              </Text>
              <Pressable onPress={local.requestAccess} style={styles.allowBtn}>
                <Text style={styles.allowText}>{denied ? 'Open settings' : PLACE.allow}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.msg}>Looking for songs {PLACE.where}…</Text>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const chips = [
    ...CATEGORIES.map((c) => ({ key: c.key, label: `${c.title} · ${byCategory[c.key].length}` })),
    ...GROUPS.map((g) => ({ key: g.key, label: g.title })),
  ];

  const header = (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {chips.map((c) => (
          <Pressable key={c.key} onPress={() => setTab(c.key)} style={[styles.chip, tab === c.key && styles.chipOn]}>
            <Text style={[styles.chipText, tab === c.key && { color: colors.bg }]}>{c.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {category && list.length > 0 && (
        <View style={styles.actions}>
          <Text style={styles.count}>{`${list.length} ${list.length === 1 ? 'song' : 'songs'}`}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
            <ShuffleButton size={26} idleColor={colors.textMuted} />
            <Pressable onPress={onPlay} style={styles.playBtn}>
              <Ionicons name={playingThis ? 'pause' : 'play'} size={26} color={colors.bg} style={!playingThis && { marginLeft: 3 }} />
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );

  const empty = {
    songs: 'No songs found. Songs in Music, Download and other folders show up here.',
    whatsapp: 'No WhatsApp audio on this phone.',
    others: 'Recordings, call recordings, Telegram audio and podcasts show up here.',
  }[tab] || 'Nothing here yet.';

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      {top}
      {category ? (
        <FlatList
          key="tracks"
          data={list}
          keyExtractor={(t) => t.id}
          ListHeaderComponent={header}
          ListEmptyComponent={<Text style={styles.empty}>{empty}</Text>}
          contentContainerStyle={styles.list}
          refreshing={false}
          onRefresh={local.rescan}
          renderItem={({ item }) => <TrackRow track={item} list={list} />}
        />
      ) : (
        <FlatList
          key="groups"
          data={local.groups[tab]}
          keyExtractor={(g) => g.name}
          ListHeaderComponent={header}
          ListEmptyComponent={<Text style={styles.empty}>{tab === 'albums' ? 'Albums show up here when songs have an album name in their details.' : empty}</Text>}
          contentContainerStyle={styles.list}
          refreshing={false}
          onRefresh={local.rescan}
          renderItem={({ item }) => (
            <Pressable onPress={() => openGroup(item.name)} style={({ pressed }) => [styles.item, pressed && { opacity: 0.6 }]}>
              <Cover uri={item.artwork} seed={item.name} icon={group.icon} style={[styles.art, group.round && { borderRadius: 28 }]} />
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={styles.title}>{item.name}</Text>
                <Text numberOfLines={1} style={styles.sub}>
                  {[group.title.slice(0, -1), item.artist, `${item.count} ${item.count === 1 ? 'song' : 'songs'}`].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  h1: { color: colors.text, fontSize: 22, fontWeight: '800' },
  folderBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.textDim, paddingHorizontal: 12, paddingVertical: 6 },
  folderText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 14 },
  bigIcon: { width: 96, height: 96, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  msg: { color: colors.textMuted, textAlign: 'center', fontSize: 14, lineHeight: 20 },
  allowBtn: { marginTop: 8, backgroundColor: colors.accent, borderRadius: 24, paddingHorizontal: 28, paddingVertical: 12 },
  allowText: { color: colors.bg, fontWeight: '700', fontSize: 15 },
  chips: { gap: 8, paddingVertical: 12 },
  chip: { borderRadius: 16, borderWidth: 1, borderColor: colors.textDim, paddingHorizontal: 14, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  count: { color: colors.textMuted, fontSize: 13 },
  playBtn: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 16, paddingBottom: 32 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  art: { width: 56, height: 56, borderRadius: 4 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  sub: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 32, paddingHorizontal: 24 },
});
