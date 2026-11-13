import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, ToastAndroid, Platform, Alert } from 'react-native';
import { colors } from '../theme';
import Cover from './Cover';
import { usePlayer } from '../context/PlayerContext';
import { useLibrary } from '../context/LibraryContext';
import Sheet, { SheetItem } from './Sheet';
import NamePrompt from './NamePrompt';
import { CAN_DOWNLOAD } from '../utils/platform';

const toast = (msg) => (Platform.OS === 'android' ? ToastAndroid.show(msg, ToastAndroid.SHORT) : Alert.alert(msg));

// "..." menu for a song: like, add to playlist, play next, add to queue, download.
export default function TrackOptions({ track, visible, onClose, playlistId }) {
  const { playNext, addToQueue } = usePlayer();
  const {
    isLiked, toggleLike, playlists, addToPlaylist, createPlaylist, removeFromPlaylist,
    isDownloaded, isDownloading, download, removeDownload,
  } = useLibrary();
  const [mode, setMode] = useState('menu'); // menu | pick
  const [naming, setNaming] = useState(false);

  if (!track) return null;
  const close = () => { setMode('menu'); onClose(); };
  const liked = isLiked(track.id);
  const downloaded = isDownloaded(track.id);
  const downloading = isDownloading(track.id);
  const inUserPlaylist = playlistId && playlistId.startsWith('u-');

  const onDownload = async () => {
    close();
    if (downloaded) { removeDownload(track.id); toast('Removed from downloads'); return; }
    toast('Downloading…');
    try { await download(track); toast(`Downloaded "${track.title}"`); }
    catch (e) { toast('Download failed. Check your connection.'); }
  };

  return (
    <>
      <Sheet visible={visible && !naming} onClose={close}>
        <View style={styles.head}>
          <Cover uri={track.artwork} seed={track.title} style={styles.art} />
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={styles.title}>{track.title}</Text>
            <Text numberOfLines={1} style={styles.artist}>{track.artist}</Text>
          </View>
        </View>

        {mode === 'menu' ? (
          <ScrollView>
            <SheetItem
              icon={liked ? 'heart' : 'heart-outline'}
              color={liked ? colors.accent : colors.text}
              label={liked ? 'Remove from Liked Songs' : 'Add to Liked Songs'}
              onPress={() => { toggleLike(track); close(); }}
            />
            <SheetItem icon="add-circle-outline" label="Add to playlist" onPress={() => setMode('pick')} />
            {inUserPlaylist && (
              <SheetItem icon="remove-circle-outline" label="Remove from this playlist"
                onPress={() => { removeFromPlaylist(playlistId, track.id); close(); }} />
            )}
            <SheetItem icon="play-forward-outline" label="Play next" onPress={() => { playNext(track); toast('Playing next'); close(); }} />
            <SheetItem icon="list-outline" label="Add to queue" onPress={() => { addToQueue(track); toast('Added to queue'); close(); }} />
            {CAN_DOWNLOAD && (
              <SheetItem
                icon={downloaded ? 'checkmark-circle' : 'arrow-down-circle-outline'}
                color={downloaded ? colors.accent : colors.text}
                label={downloaded ? 'Remove download' : downloading ? 'Downloading…' : 'Download'}
                onPress={downloading ? undefined : onDownload}
                right={downloading ? <ActivityIndicator color={colors.accent} /> : null}
              />
            )}
          </ScrollView>
        ) : (
          <ScrollView>
            <SheetItem icon="add" label="New playlist" onPress={() => setNaming(true)} />
            {playlists.map((p) => {
              const has = p.tracks.some((t) => t.id === track.id);
              return (
                <SheetItem
                  key={p.id}
                  icon={has ? 'checkmark-circle' : 'musical-notes-outline'}
                  color={has ? colors.accent : colors.text}
                  label={`${p.title}  ·  ${p.tracks.length}`}
                  onPress={() => {
                    if (!has) { addToPlaylist(p.id, track); toast(`Added to ${p.title}`); }
                    close();
                  }}
                />
              );
            })}
            {!playlists.length && <Text style={styles.hint}>You haven't made any playlists yet.</Text>}
          </ScrollView>
        )}
      </Sheet>

      <NamePrompt
        visible={naming}
        title="Give your playlist a name"
        onCancel={() => setNaming(false)}
        onConfirm={(name) => {
          const p = createPlaylist(name, track);
          setNaming(false);
          toast(`Added to ${p.title}`);
          close();
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.surfaceHigh, marginBottom: 4 },
  art: { width: 48, height: 48, borderRadius: 4 },
  title: { color: colors.text, fontWeight: '700', fontSize: 15 },
  artist: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  hint: { color: colors.textMuted, paddingHorizontal: 20, paddingVertical: 8 },
});
