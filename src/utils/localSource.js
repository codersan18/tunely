// Where "On this phone" finds songs: Android's media library (the browser version, localSource.web.js,
// reads a music folder the person picks). Used by LocalMusicContext.
import { Linking, Platform } from 'react-native';
import {
  Asset, AssetField, MediaType, Query, getPermissionsAsync, requestPermissionsAsync,
} from 'expo-media-library';

export const LOCAL_SUPPORTED = Platform.OS === 'android';
export const PLACE = {
  title: 'On this phone',
  where: 'on your phone',
  icon: 'phone-portrait',
  intro: 'Play the songs saved on your phone: Music, Download, WhatsApp audio and more. They play from your phone; nothing is copied or uploaded.',
  denied: 'VibeRoom isn\'t allowed to see the music on your phone. Turn on "Music and audio" in Settings → Permissions.',
  allow: 'Allow access',
  canChangeFolder: false,
};

const PAGE = 200;
const MIN_SECONDS = 30; // shorter files are ringtones, notification sounds and voice notes

// Android gives milliseconds (the docs say seconds): no song is 10 hours long, so tell them apart.
const toSeconds = (d) => (!d ? 0 : d > 36000 ? d / 1000 : d);

const fromPermission = (p) => (p.granted ? 'granted' : p.canAskAgain ? 'needs-permission' : 'denied');

/** 'granted' | 'needs-permission' | 'denied' */
export async function checkAccess() {
  return fromPermission(await getPermissionsAsync(false, ['audio']));
}

export async function requestAccess(current) {
  if (current === 'denied') { Linking.openSettings().catch(() => {}); return 'denied'; }
  return fromPermission(await requestPermissionsAsync(false, ['audio']));
}

export const changeFolder = null;

// Run `fn` over `items`, a few at a time.
async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

/** The audio files: [{ id, uri, path, filename, duration (s), modified }], newest first. */
export async function listFiles() {
  const all = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await new Query()
      .eq(AssetField.MEDIA_TYPE, MediaType.AUDIO)
      .orderBy({ key: AssetField.MODIFICATION_TIME, ascending: false })
      .limit(PAGE)
      .offset(offset)
      .exeForMetadata();
    all.push(...page);
    if (page.length < PAGE) break;
  }
  const metas = all.filter((m) => toSeconds(m.duration) >= MIN_SECONDS);
  return (await inBatches(metas, 25, async (m) => {
    try {
      const uri = await new Asset(m.id).getUri();
      return { id: m.id, uri, path: uri, filename: m.filename, duration: toSeconds(m.duration), modified: m.modificationTime };
    } catch (e) { return null; }
  })).filter(Boolean);
}
