import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { useLibrary } from '../context/LibraryContext';
import { useCatalog } from '../context/CatalogContext';
import NamePrompt from '../components/NamePrompt';
import Cover from '../components/Cover';

const FILTERS = ['Playlists', 'Albums', 'Artists', 'Downloaded'];

function GradientArt({ icon, from, to }) {
  return (
    <LinearGradient colors={[from, to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.art}>
      <Ionicons name={icon} size={26} color="#fff" />
    </LinearGradient>
  );
}

function Item({ art, title, sub, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.item, pressed && { opacity: 0.6 }]}>
      {art}
      <View style={styles.meta}>
        <Text numberOfLines={1} style={styles.title}>{title}</Text>
        <Text numberOfLines={1} style={styles.sub}>{sub}</Text>
      </View>
    </Pressable>
  );
}

export default function LibraryScreen({ navigation }) {
  const { liked, playlists, downloadedTracks, createPlaylist } = useLibrary();
  const { songs, artists, albums } = useCatalog();
  const [filter, setFilter] = useState('Playlists');
  const [naming, setNaming] = useState(false);
  const open = (playlistId) => navigation.navigate('Playlist', { playlistId });

  const pinned = (
    <View>
      <Item
        art={<GradientArt icon="musical-notes" from="#2A5C3B" to="#9BE8D3" />}
        title="All songs"
        sub={`${songs.length} songs in the library`}
        onPress={() => open('all')}
      />
      <Item
        art={<GradientArt icon="heart" from="#4B2BD6" to="#9BE8D3" />}
        title="Liked Songs"
        sub={`Playlist · ${liked.length} songs`}
        onPress={() => open('liked')}
      />
      <Item
        art={<GradientArt icon="arrow-down" from="#0B5C44" to="#2EE6A6" />}
        title="Downloaded"
        sub={`${downloadedTracks.length} songs · plays offline`}
        onPress={() => open('downloads')}
      />
    </View>
  );

  let content;
  if (filter === 'Playlists') {
    content = (
      <FlatList
        data={playlists}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={pinned}
        ListFooterComponent={!playlists.length && (
          <Pressable onPress={() => setNaming(true)} style={styles.createRow}>
            <View style={[styles.art, styles.placeholder]}><Ionicons name="add" size={30} color={colors.text} /></View>
            <Text style={styles.title}>Create a playlist</Text>
          </Pressable>
        )}
        contentContainerStyle={styles.list}
        renderItem={({ item: p }) => (
          <Item
            art={<Cover uri={p.tracks[0]?.artwork} seed={p.title} icon="list" style={styles.art} />}
            title={p.title}
            sub={`Playlist · ${p.tracks.length} songs`}
            onPress={() => open(p.id)}
          />
        )}
      />
    );
  } else if (filter === 'Albums') {
    content = (
      <FlatList
        data={albums}
        keyExtractor={(a) => a.name}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>Albums show up here once songs have an album name.</Text>}
        renderItem={({ item }) => (
          <Item
            art={<Cover uri={item.artwork} seed={item.name} icon="disc" style={styles.art} />}
            title={item.name}
            sub={['Album', item.artist, `${item.count} ${item.count === 1 ? 'song' : 'songs'}`].filter(Boolean).join(' · ')}
            onPress={() => open(`album:${item.name}`)}
          />
        )}
      />
    );
  } else if (filter === 'Downloaded') {
    content = (
      <FlatList
        data={downloadedTracks}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>Download songs from their ••• menu to play them without internet.</Text>}
        renderItem={({ item }) => (
          <Item
            art={<Cover uri={item.artwork} seed={item.title} style={styles.art} />}
            title={item.title}
            sub={`Song · ${item.artist}`}
            onPress={() => open('downloads')}
          />
        )}
      />
    );
  } else {
    content = (
      <FlatList
        data={artists}
        keyExtractor={(a) => a.name}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>Artists show up here once songs are added.</Text>}
        renderItem={({ item }) => (
          <Item
            art={<Cover uri={item.artwork} seed={item.name} icon="person" style={[styles.art, { borderRadius: 32 }]} />}
            title={item.name}
            sub={`Artist · ${item.count} ${item.count === 1 ? 'song' : 'songs'}`}
            onPress={() => open(`artist:${item.name}`)}
          />
        )}
      />
    );
  }

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <View style={styles.top}>
        <Text style={styles.h1}>Your Library</Text>
        <View style={styles.topIcons}>
          <Pressable onPress={() => navigation.navigate('Admin')} hitSlop={10} accessibilityLabel="Manage songs">
            <Ionicons name="lock-closed-outline" size={22} color={colors.textMuted} />
          </Pressable>
          <Pressable onPress={() => setNaming(true)} hitSlop={10} accessibilityLabel="Create playlist">
            <Ionicons name="add" size={30} color={colors.text} />
          </Pressable>
        </View>
      </View>
      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <Pressable key={f} onPress={() => setFilter(f)} style={[styles.filter, filter === f && styles.filterOn]}>
            <Text style={[styles.filterText, filter === f && { color: colors.bg }]}>{f}</Text>
          </Pressable>
        ))}
      </View>
      {content}
      <NamePrompt
        visible={naming}
        title="Give your playlist a name"
        onCancel={() => setNaming(false)}
        onConfirm={(name) => {
          const p = createPlaylist(name);
          setNaming(false);
          open(p.id);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12 },
  topIcons: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  h1: { color: colors.text, fontSize: 24, fontWeight: '800' },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 14 },
  filter: { borderRadius: 16, borderWidth: 1, borderColor: colors.textDim, paddingHorizontal: 14, paddingVertical: 6 },
  filterOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  list: { paddingHorizontal: 16, paddingBottom: 24 },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  art: { width: 64, height: 64, borderRadius: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceHigh },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  meta: { flex: 1 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  sub: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 32, paddingHorizontal: 24 },
});
