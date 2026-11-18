import { useEffect, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { useCatalog } from '../context/CatalogContext';
import { usePlayer } from '../context/PlayerContext';
import { songIdFromLink } from '../utils/share';

// Opens shared song links (https://viberoom.expo.app/?song=<id>): plays the song and shows the player.
// Works when the app is opened by the link and when a link arrives while it's open, and on the website.
export default function SongLinkHandler({ navigation }) {
  const { songs } = useCatalog();
  const { playTrack } = usePlayer();
  const [pending, setPending] = useState(null);

  useEffect(() => {
    const take = (url) => { const id = songIdFromLink(url); if (id) setPending(id); };
    Linking.getInitialURL().then(take).catch(() => {});
    const sub = Linking.addEventListener('url', (e) => take(e.url));
    return () => sub.remove();
  }, []);

  // Once the song list is there (it loads after start), play the linked song.
  useEffect(() => {
    if (!pending || !songs.length) return;
    const song = songs.find((s) => s.songId === pending);
    if (!song) return;
    setPending(null);
    playTrack(song, [song]);
    navigation.navigate('Player');
    if (Platform.OS === 'web') {
      try { window.history.replaceState(null, '', window.location.pathname); } catch (e) { /* ignore */ }
    }
  }, [pending, songs]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
