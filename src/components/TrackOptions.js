import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { File } from 'expo-file-system';
import { colors } from '../theme';
import { keyStore } from '../utils/files';
import { shareSong } from '../utils/share';
import Cover from './Cover';
import { usePlayer } from '../context/PlayerContext';
import { useLibrary } from '../context/LibraryContext';
import Sheet, { SheetItem } from './Sheet';
import NamePrompt from './NamePrompt';

import { toast } from '../utils/platform';

// "..." menu for a song: like, add to playlist, play next, add to queue, download.
export default function TrackOptions({ track, visible, onClose, playlistId }) {
  const { playNext, addToQueue } = usePlayer();
  const {
    isLiked, toggleLike, playlists, addToPlaylist, createPlaylist, removeFromPlaylist,
    isDownloaded, isDownloading, download, removeDownload,
  } = useLibrary();
  const [mode, setMode] = useState('menu'); // menu | pick
  const [naming, setNaming] = useState(false);
  const navigation = useNavigation();

  // The admin can add a song from the phone to the library (only once Manage songs is unlocked).
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!visible || !track?.local) return;
    keyStore.get('tunely.adminKey').then((k) => setIsAdmin(!!k)).catch(() => {});
  }, [visible, track?.local]);

  if (!track) return null;

  const onAddToLibrary = () => {
    close();
    const name = decodeURIComponent(track.url.split('/').pop() || `${track.title}.mp3`);
    const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || 'mp3').toLowerCase();
    const mimeType = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', flac: 'audio/flac', ogg: 'audio/ogg', opus: 'audio/ogg' }[ext] || 'audio/mpeg';
    let size = 0;
    try { size = new File(track.url).size || 0; } catch (e) { /* unknown */ }
    navigation.navigate('Admin', { files: [{ uri: track.url, name, mimeType, size }] });
  };
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
            {!!track.songId && (
              <SheetItem icon="share-social-outline" label="Share" onPress={() => { close(); shareSong(track); }} />
            )}
            {track.local && isAdmin && (
              <SheetItem icon="cloud-upload-outline" label="Add to VibeRoom library" onPress={onAddToLibrary} />
            )}
            {!track.local && ( // songs on the phone already play without internet
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
