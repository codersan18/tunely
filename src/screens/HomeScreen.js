import React from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { usePlayer } from '../context/PlayerContext';
import { useLibrary } from '../context/LibraryContext';
import { useCatalog } from '../context/CatalogContext';
import TrackRow from '../components/TrackRow';
import Cover from '../components/Cover';
import { useProfiles } from '../context/ProfilesContext';
import { greeting } from '../utils/greeting';


function Carousel({ title, data, renderItem, keyExtractor }) {
  if (!data?.length) return null;
  return (
    <>
      <Text style={styles.h2}>{title}</Text>
      <FlatList
        horizontal
        data={data}
        keyExtractor={keyExtractor}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
        renderItem={renderItem}
      />
    </>
  );
}

export default function HomeScreen({ navigation }) {
  const { playTrack } = usePlayer();
  const { recent, liked, downloadedTracks, playlists } = useLibrary();
  const { songs, artists, albums, popular, status, refreshing, refresh } = useCatalog();
  const top = popular.slice(0, 15);
  const name = useProfiles().profile?.name || '';
  const open = (playlistId) => navigation.navigate('Playlist', { playlistId });

  // Quick-access tiles: the user's own collections.
  const tiles = [
    { id: 'all', title: 'All songs', icon: 'musical-notes', from: '#2A5C3B' },
    { id: 'liked', title: 'Liked Songs', icon: 'heart', from: '#4B2BD6', count: liked.length },
    { id: 'downloads', title: 'Downloaded', icon: 'arrow-down', from: '#0B5C44', count: downloadedTracks.length },
    ...playlists.slice(0, 3).map((p) => ({ id: p.id, title: p.title, artwork: p.tracks[0]?.artwork, icon: 'list' })),
  ];

  // Recently played, but only songs that still exist in the library (or are downloaded).
  const available = new Set([...songs, ...downloadedTracks].map((t) => t.id));
  const jumpBack = recent.filter((t) => available.has(t.id)).slice(0, 15);
  const newest = songs.slice(0, 15);

  const songCard = (list, round) => ({ item }) => (
    <Pressable onPress={() => playTrack(item, list)} style={styles.card}>
      <Cover uri={item.artwork} seed={item.title} size={140} round={round} style={!round && { borderRadius: 6 }} />
      <Text numberOfLines={1} style={styles.cardTitle}>{item.title}</Text>
      <Text numberOfLines={1} style={styles.cardSub}>{item.artist}</Text>
    </Pressable>
  );

  const header = (
    <View>
      <View style={styles.header}>
        <Text style={styles.h1} numberOfLines={2}>
          {greeting()}{name ? ' ' : ''}{!!name && <Text style={styles.name}>{name}</Text>}
        </Text>
      </View>

      {(status === 'offline' || status === 'error') && (
        <Pressable onPress={refresh} style={styles.banner}>
          <Ionicons name="cloud-offline-outline" size={18} color={colors.text} />
          <Text style={styles.bannerText}>
            {status === 'error' && !songs.length
              ? "Can't reach the music library. Your downloads still play."
              : "You're offline. Downloaded songs play; others need internet."}
          </Text>
          <Text style={styles.bannerRetry}>Retry</Text>
        </Pressable>
      )}

      <View style={styles.grid}>
        {tiles.map((t) => (
          <Pressable key={t.id} onPress={() => open(t.id)} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}>
            <View style={styles.tileInner}>
              {t.artwork !== undefined || !t.from ? (
                <Cover uri={t.artwork} seed={t.title} icon={t.icon} style={styles.tileArt} />
              ) : (
                <LinearGradient colors={[t.from, '#9BE8D3']} style={[styles.tileArt, styles.center]}>
                  <Ionicons name={t.icon} size={22} color="#fff" />
                </LinearGradient>
              )}
              <Text numberOfLines={2} style={styles.tileText}>{t.title}</Text>
            </View>
          </Pressable>
        ))}
      </View>

      {status === 'loading' && !songs.length && <ActivityIndicator color={colors.accent} style={{ marginTop: 32 }} />}

      <Carousel title="Jump back in" data={jumpBack} keyExtractor={(t) => t.id} renderItem={songCard(jumpBack, true)} />
      {top.length > 0 && (
        <Pressable onPress={() => open('popular')} style={styles.h2Row}>
          <Text style={[styles.h2, styles.h2Inline]}>Popular this week</Text>
          <Text style={styles.seeAll}>See all</Text>
        </Pressable>
      )}
      {top.length > 0 && (
        <FlatList
          horizontal
          data={top}
          keyExtractor={(t) => t.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
          renderItem={songCard(top)}
        />
      )}
      <Carousel title="Recently added" data={newest} keyExtractor={(t) => t.id} renderItem={songCard(newest)} />
      <Carousel
        title="Albums"
        data={albums.slice(0, 15)}
        keyExtractor={(a) => a.name}
        renderItem={({ item }) => (
          <Pressable onPress={() => open(`album:${item.name}`)} style={styles.card}>
            <Cover uri={item.artwork} seed={item.name} size={140} icon="disc" style={{ borderRadius: 6 }} />
            <Text numberOfLines={1} style={styles.cardTitle}>{item.name}</Text>
            <Text numberOfLines={1} style={styles.cardSub}>
              {[item.artist, `${item.count} ${item.count === 1 ? 'song' : 'songs'}`].filter(Boolean).join(' · ')}
            </Text>
          </Pressable>
        )}
      />
      <Carousel
        title="Artists"
        data={artists.slice(0, 15)}
        keyExtractor={(a) => a.name}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate('Playlist', { playlistId: `artist:${item.name}` })} style={styles.card}>
            <Cover uri={item.artwork} seed={item.name} size={140} round icon="person" />
            <Text numberOfLines={1} style={[styles.cardTitle, { textAlign: 'center' }]}>{item.name}</Text>
            <Text style={[styles.cardSub, { textAlign: 'center' }]}>{item.count} {item.count === 1 ? 'song' : 'songs'}</Text>
          </Pressable>
        )}
      />

      {songs.length > 0 && <Text style={styles.h2}>All songs</Text>}
    </View>
  );

  return (
    <LinearGradient colors={['#1D3B33', colors.bg]} locations={[0, 0.35]} style={{ flex: 1 }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <FlatList
          data={songs}
          keyExtractor={(t) => t.id}
          ListHeaderComponent={header}
          ListEmptyComponent={status !== 'loading' && (
            <Text style={styles.empty}>No songs in the library yet.</Text>
          )}
          renderItem={({ item }) => (
            <View style={{ paddingHorizontal: 16 }}>
              <TrackRow track={item} list={songs} />
            </View>
          )}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.accent} colors={[colors.accent]} />}
        />
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 24 },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 },
  h1: { color: colors.text, fontSize: 24, fontWeight: '800' },
  name: { color: colors.accent },
  h2: { color: colors.text, fontSize: 21, fontWeight: '800', marginTop: 28, marginBottom: 12, paddingHorizontal: 16 },
  row: { gap: 14, paddingHorizontal: 16 },
  h2Row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingRight: 16 },
  h2Inline: { flex: 1 },
  seeAll: { color: colors.textMuted, fontSize: 13, fontWeight: '700' },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 12, padding: 12, borderRadius: 8, backgroundColor: colors.surfaceHigh },
  bannerText: { flex: 1, color: colors.text, fontSize: 13 },
  bannerRetry: { color: colors.accent, fontWeight: '700', fontSize: 13 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12 },
  tile: { width: '50%', padding: 4 },
  tileInner: { flexDirection: 'row', alignItems: 'center', height: 56, borderRadius: 4, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)' },
  tileArt: { width: 56, height: 56 },
  center: { alignItems: 'center', justifyContent: 'center' },
  tileText: { flex: 1, color: colors.text, fontWeight: '700', fontSize: 13, paddingHorizontal: 8 },
  card: { width: 140 },
  cardTitle: { color: colors.text, fontWeight: '700', fontSize: 14, marginTop: 8 },
  cardSub: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 24, paddingHorizontal: 24 },
});
