import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList, Alert, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { useCatalog, hasArtist } from '../context/CatalogContext';
import Cover from '../components/Cover';
import { usePlayer } from '../context/PlayerContext';
import { useLibrary } from '../context/LibraryContext';
import TrackRow from '../components/TrackRow';
import NamePrompt from '../components/NamePrompt';
import Sheet, { SheetItem } from '../components/Sheet';
import ShuffleButton from '../components/ShuffleButton';
import { CAN_DOWNLOAD, confirmAction } from '../utils/platform';

const formatMB = (bytes) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

export default function PlaylistScreen({ route, navigation }) {
  const { playlistId } = route.params;
  const { playTrack, currentTrack, isPlaying, togglePlay, shuffleMode } = usePlayer();
  const {
    liked, playlists, downloadedTracks, downloadedBytes, deletePlaylist, renamePlaylist,
    isDownloaded, isDownloading, downloadMany, removeDownload,
  } = useLibrary();
  const { songs, artists, albums, status } = useCatalog();
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const isUser = playlistId.startsWith('u-');

  const playlist = useMemo(() => {
    if (playlistId === 'liked') {
      return { id: 'liked', title: 'Liked Songs', description: 'Songs you have liked', color: '#4B2BD6', icon: 'heart', tracks: liked };
    }
    if (playlistId === 'downloads') {
      return {
        id: 'downloads', title: 'Downloaded', color: '#0B5C44', icon: 'arrow-down', tracks: downloadedTracks,
        description: `Plays without internet · ${formatMB(downloadedBytes)} used`,
      };
    }
    if (isUser) {
      const p = playlists.find((x) => x.id === playlistId);
      return p && { ...p, description: 'Your playlist', color: '#3A3A46', artwork: p.tracks[0]?.artwork, icon: 'musical-notes' };
    }
    if (playlistId === 'all') {
      return { id: 'all', title: 'All songs', description: 'Everything in the VibeRoom library', color: '#2A5C3B', icon: 'musical-notes', tracks: songs };
    }
    if (playlistId.startsWith('artist:')) {
      const name = playlistId.slice('artist:'.length);
      const artist = artists.find((x) => x.name.toLowerCase() === name.toLowerCase());
      return {
        id: playlistId, title: name, description: 'Artist', color: '#4A2A5C', icon: 'person', round: true,
        artwork: artist?.artwork, tracks: songs.filter((t) => hasArtist(t, name)),
      };
    }
    if (playlistId.startsWith('album:')) {
      const name = playlistId.slice('album:'.length);
      const album = albums.find((x) => x.name.toLowerCase() === name.toLowerCase());
      // Oldest upload first, which is usually track order when an album is uploaded in one go.
      const tracks = songs.filter((t) => t.album && t.album.toLowerCase() === name.toLowerCase())
        .sort((a, b) => ((a.createdAt || '') < (b.createdAt || '') ? -1 : 1));
      return {
        id: playlistId, title: album?.name || name, color: '#5C3A1F', icon: 'disc',
        description: ['Album', album?.artist].filter(Boolean).join(' · '),
        artwork: album?.artwork, tracks,
      };
    }
    if (playlistId.startsWith('genre:')) {
      const name = playlistId.slice('genre:'.length);
      return {
        id: playlistId, title: name, description: 'Genre', color: '#1F4D5C', icon: 'musical-notes',
        tracks: songs.filter((t) => t.genre && t.genre.toLowerCase() === name.toLowerCase()),
      };
    }
    return null;
  }, [playlistId, isUser, songs, artists, albums, liked, playlists, downloadedTracks, downloadedBytes]);

  if (!playlist) {
    // e.g. the playlist was just deleted
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  const list = playlist.tracks;
  const playingThis = isPlaying && list.some((t) => t.id === currentTrack?.id);
  const allDownloaded = list.length > 0 && list.every((t) => isDownloaded(t.id));
  const anyDownloading = list.some((t) => isDownloading(t.id));

  const onPlay = () => {
    if (!list.length) return;
    if (list.some((t) => t.id === currentTrack?.id)) togglePlay();
    else playTrack(shuffleMode !== 'off' ? list[Math.floor(Math.random() * list.length)] : list[0], list);
  };

  const onDownloadAll = () => {
    if (anyDownloading || !list.length) return;
    if (allDownloaded) {
      Alert.alert('Remove downloads?', 'These songs will no longer play offline.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => list.forEach((t) => removeDownload(t.id)) },
      ]);
    } else {
      downloadMany(list.filter((t) => !isDownloaded(t.id)));
    }
  };

  const onDelete = () => {
    setMenu(false);
    confirmAction('Delete playlist?', `"${playlist.title}" will be removed from your library.`, 'Delete',
      () => { navigation.goBack(); deletePlaylist(playlist.id); });
  };

  const header = (
    <View>
      <View style={styles.artWrap}>
        {playlist.artwork ? (
          <Cover uri={playlist.artwork} seed={playlist.title} icon={playlist.icon} style={[styles.art, playlist.round && { borderRadius: 115 }]} />
        ) : (
          <LinearGradient colors={[playlist.color, '#9BE8D3']} style={[styles.art, styles.center]}>
            <Ionicons name={playlist.icon || 'musical-notes'} size={72} color="#fff" />
          </LinearGradient>
        )}
      </View>
      <Text style={styles.title}>{playlist.title}</Text>
      {!!playlist.description && <Text numberOfLines={2} style={styles.desc}>{playlist.description}</Text>}
      <Text style={styles.count}>
        {`${list.length} ${list.length === 1 ? 'song' : 'songs'}`}
      </Text>
      <View style={styles.actions}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20 }}>
          {playlistId !== 'downloads' && CAN_DOWNLOAD && (
            <Pressable onPress={onDownloadAll} hitSlop={8}>
              {anyDownloading ? (
                <ActivityIndicator color={colors.accent} />
              ) : (
                <Ionicons
                  name={allDownloaded ? 'arrow-down-circle' : 'arrow-down-circle-outline'}
                  size={30}
                  color={allDownloaded ? colors.accent : colors.textMuted}
                />
              )}
            </Pressable>
          )}
          {isUser && (
            <Pressable onPress={() => setMenu(true)} hitSlop={8}>
              <Ionicons name="ellipsis-horizontal" size={28} color={colors.textMuted} />
            </Pressable>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
          <ShuffleButton size={28} idleColor={colors.textMuted} />
          <Pressable onPress={onPlay} style={styles.playBtn}>
            <Ionicons name={playingThis ? 'pause' : 'play'} size={28} color={colors.bg} style={!playingThis && { marginLeft: 3 }} />
          </Pressable>
        </View>
      </View>
    </View>
  );

  const emptyText = {
    liked: 'Tap the heart on any song to add it here.',
    downloads: 'Download songs or playlists to listen without internet.',
    all: status === 'loading' ? 'Loading songs...' : 'No songs in the library yet.',
  }[playlistId] || (playlistId.includes(':')
    ? 'No songs here yet.'
    : 'Add songs from any song\'s ••• menu → "Add to playlist".');

  return (
    <LinearGradient colors={[playlist.color, colors.bg]} locations={[0, 0.45]} style={{ flex: 1 }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <Pressable onPress={() => navigation.goBack()} style={styles.back} hitSlop={10}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Pressable>
        <FlatList
          data={list}
          keyExtractor={(t) => t.id}
          ListHeaderComponent={header}
          ListEmptyComponent={<Text style={styles.empty}>{emptyText}</Text>}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}
          renderItem={({ item, index }) => <TrackRow track={item} list={list} index={index} playlistId={playlistId} />}
        />
      </SafeAreaView>

      <Sheet visible={menu} onClose={() => setMenu(false)}>
        <SheetItem icon="create-outline" label="Rename playlist" onPress={() => { setMenu(false); setRenaming(true); }} />
        <SheetItem icon="trash-outline" color={colors.danger} label="Delete playlist" onPress={onDelete} />
      </Sheet>
      <NamePrompt
        visible={renaming}
        title="Rename playlist"
        confirmLabel="Save"
        initialValue={playlist.title}
        onCancel={() => setRenaming(false)}
        onConfirm={(name) => { if (name.trim()) renamePlaylist(playlist.id, name.trim()); setRenaming(false); }}
      />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  back: { paddingHorizontal: 12, paddingVertical: 6 },
  artWrap: { alignItems: 'center', marginTop: 4, marginBottom: 20, elevation: 12 },
  art: { width: 230, height: 230, borderRadius: 4 },
  center: { alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 24, fontWeight: '800' },
  desc: { color: colors.textMuted, fontSize: 13, marginTop: 6 },
  count: { color: colors.textMuted, fontSize: 13, marginTop: 4 },
  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginVertical: 14 },
  playBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 24, paddingHorizontal: 24 },
});
