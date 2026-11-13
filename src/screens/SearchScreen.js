import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { useCatalog } from '../context/CatalogContext';
import { useLibrary } from '../context/LibraryContext';
import TrackRow from '../components/TrackRow';
import Cover from '../components/Cover';

const GENRE_COLORS = ['#7C3AED', '#0E7490', '#B45309', '#4D7C0F', '#BE185D', '#1D4ED8', '#9D174D', '#0F766E'];

// Searches the library on the phone, so it works offline too.
const matches = (t, s) => [t.title, t.artist, t.album, t.genre, t.language, t.mood].some((f) => f && f.toLowerCase().includes(s));

export default function SearchScreen({ navigation }) {
  const { songs, artists, albums, genres } = useCatalog();
  const { downloadedTracks } = useLibrary();
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  // Library songs, plus downloaded songs in case the list hasn't loaded.
  const all = useMemo(
    () => [...new Map([...songs, ...downloadedTracks].map((t) => [t.id, t])).values()],
    [songs, downloadedTracks],
  );
  const results = useMemo(() => (q ? all.filter((t) => matches(t, q)) : []), [all, q]);
  const artistHits = useMemo(() => (q ? artists.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 5) : []), [artists, q]);

  const albumHits = useMemo(() => (q ? albums.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 5) : []), [albums, q]);

  const openArtist = (name) => navigation.navigate('Playlist', { playlistId: `artist:${name}` });
  const openAlbum = (name) => navigation.navigate('Playlist', { playlistId: `album:${name}` });
  const openGenre = (name) => navigation.navigate('Playlist', { playlistId: `genre:${name}` });

  const browse = [
    ...genres.map((g, i) => ({ key: `g-${g.name}`, label: g.name, sub: `${g.count} songs`, color: GENRE_COLORS[i % GENRE_COLORS.length], onPress: () => openGenre(g.name) })),
  ];

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <Text style={styles.h1}>Search</Text>
      <View style={styles.inputWrap}>
        <Ionicons name="search" size={20} color="#222" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Songs, artists, albums or genres"
          placeholderTextColor="#555"
          style={styles.input}
          returnKeyType="search"
          autoCorrect={false}
        />
        {!!query && (
          <Pressable onPress={() => setQuery('')} hitSlop={10}>
            <Ionicons name="close" size={20} color="#222" />
          </Pressable>
        )}
      </View>

      {!q ? (
        <FlatList
          key="browse"
          data={browse}
          numColumns={2}
          keyExtractor={(g) => g.key}
          ListHeaderComponent={(
            <View>
              {artists.length > 0 && <Text style={styles.h2}>Artists</Text>}
              {artists.slice(0, 8).map((a) => (
                <Pressable key={a.name} onPress={() => openArtist(a.name)} style={({ pressed }) => [styles.item, pressed && { opacity: 0.6 }]}>
                  <Cover uri={a.artwork} seed={a.name} size={52} round icon="person" />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={styles.itemTitle}>{a.name}</Text>
                    <Text style={styles.itemSub}>Artist · {a.count} {a.count === 1 ? 'song' : 'songs'}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
                </Pressable>
              ))}
              {browse.length > 0 && <Text style={styles.h2}>Browse by genre</Text>}
            </View>
          )}
          ListEmptyComponent={!artists.length && <Text style={styles.empty}>Songs will show up here once they're added.</Text>}
          columnWrapperStyle={{ gap: 12 }}
          contentContainerStyle={{ gap: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 }}
          renderItem={({ item }) => (
            <Pressable onPress={item.onPress} style={[styles.genre, { backgroundColor: item.color }]}>
              <Text style={styles.genreText}>{item.label}</Text>
              <Text style={styles.genreSub}>{item.sub}</Text>
            </Pressable>
          )}
        />
      ) : (
        <FlatList
          key="results"
          data={results}
          keyExtractor={(t) => t.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 }}
          ListHeaderComponent={(artistHits.length > 0 || albumHits.length > 0) && (
            <View style={{ marginBottom: 8 }}>
              {albumHits.map((a) => (
                <Pressable key={`al-${a.name}`} onPress={() => openAlbum(a.name)} style={({ pressed }) => [styles.item, pressed && { opacity: 0.6 }]}>
                  <Cover uri={a.artwork} seed={a.name} size={52} icon="disc" style={{ borderRadius: 4 }} />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={styles.itemTitle}>{a.name}</Text>
                    <Text numberOfLines={1} style={styles.itemSub}>{['Album', a.artist].filter(Boolean).join(' · ')}</Text>
                  </View>
                </Pressable>
              ))}
              {artistHits.map((a) => (
                <Pressable key={a.name} onPress={() => openArtist(a.name)} style={({ pressed }) => [styles.item, pressed && { opacity: 0.6 }]}>
                  <Cover uri={a.artwork} seed={a.name} size={52} round icon="person" />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={styles.itemTitle}>{a.name}</Text>
                    <Text style={styles.itemSub}>Artist</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
          ListEmptyComponent={!artistHits.length && !albumHits.length && <Text style={styles.empty}>No songs match "{query.trim()}".</Text>}
          renderItem={({ item }) => <TrackRow track={item} list={results} />}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  h1: { color: colors.text, fontSize: 26, fontWeight: '800', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 },
  h2: { color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 8, marginBottom: 8 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', marginHorizontal: 16, borderRadius: 6, paddingHorizontal: 12, gap: 8, height: 46 },
  input: { flex: 1, fontSize: 15, color: '#111' },
  item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  itemTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  itemSub: { color: colors.textMuted, fontSize: 13, marginTop: 3 },
  genre: { flex: 1, height: 96, borderRadius: 8, padding: 12, overflow: 'hidden' },
  genreText: { color: colors.text, fontSize: 17, fontWeight: '800' },
  genreSub: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 4 },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },
});
