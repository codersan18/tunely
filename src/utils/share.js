// Share a library song as a link: https://viberoom.expo.app/?song=<id>
// The link opens the song in the app (Android, see app.json intentFilters) or on the website,
// where src/components/SongLinkHandler.js plays it.

import { Platform, Share } from 'react-native';
import { toast } from './platform';

export const SITE = 'https://viberoom.expo.app';
export const songLink = (track) => `${SITE}/?song=${track.songId}`;

// The song id in a shared link, or null.
export const songIdFromLink = (url) => url?.match(/[?&]song=([0-9a-f-]{36})/i)?.[1] || null;

export async function shareSong(track) {
  const url = songLink(track);
  const text = `${track.title} – ${track.artist}`;
  if (Platform.OS === 'web') {
    try {
      if (navigator.share) { await navigator.share({ title: track.title, text, url }); return; }
      await navigator.clipboard.writeText(url);
      toast('Link copied');
    } catch (e) { /* cancelled */ }
    return;
  }
  try { await Share.share({ message: `${text} on VibeRoom\n${url}` }); } catch (e) { /* cancelled */ }
}
