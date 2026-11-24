// Where the Videos side of Home finds videos: the phone's media library, grouped by folder like MX
// Player (the browser version, videoSource.web.js, reads a folder the person picks).
import { Linking, Platform } from 'react-native';
import {
  Asset, AssetField, MediaType, Query, getPermissionsAsync, requestPermissionsAsync,
} from 'expo-media-library';
import AudioEditor, { VIDEO_TOOLS_SUPPORTED } from '../../modules/audio-editor';

export const VIDEOS_SUPPORTED = Platform.OS === 'android';
export const PLACE = {
  intro: 'Watch the videos saved on your phone: Camera, WhatsApp, Downloads and more. They play from your phone; nothing is uploaded.',
  denied: 'VibeRoom isn\'t allowed to see the videos on your phone. Turn on "Photos and videos" in Settings → Permissions.',
  allow: 'Allow access',
  canChangeFolder: false,
};

const PAGE = 200;
const toSeconds = (d) => (!d ? 0 : d > 36000 ? d / 1000 : d); // Android gives milliseconds
const fromPermission = (p) => (p.granted ? 'granted' : p.canAskAgain ? 'needs-permission' : 'denied');

/** 'granted' | 'needs-permission' | 'denied' */
export async function checkAccess() {
  return fromPermission(await getPermissionsAsync(false, ['video']));
}

export async function requestAccess(current) {
  if (current === 'denied') { Linking.openSettings().catch(() => {}); return 'denied'; }
  return fromPermission(await requestPermissionsAsync(false, ['video']));
}

export const changeFolder = null;

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

// "file:///storage/emulated/0/DCIM/Camera/a.mp4" -> "Camera"
function folderOf(uri) {
  try {
    const parts = decodeURIComponent(uri.replace(/^file:\/\//, '')).split('/').filter(Boolean);
    return parts.length > 1 ? parts[parts.length - 2] : 'Videos';
  } catch (e) {
    return 'Videos';
  }
}

/** The videos: [{ id, uri, filename, folder, duration (s), modified, width, height }], newest first. */
export async function listVideos() {
  const all = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await new Query()
      .eq(AssetField.MEDIA_TYPE, MediaType.VIDEO)
      .orderBy({ key: AssetField.MODIFICATION_TIME, ascending: false })
      .limit(PAGE)
      .offset(offset)
      .exeForMetadata();
    all.push(...page);
    if (page.length < PAGE) break;
  }
  return (await inBatches(all, 25, async (m) => {
    try {
      const uri = await new Asset(m.id).getUri();
      return {
        id: m.id, uri, filename: m.filename || 'Video', folder: folderOf(uri),
        duration: toSeconds(m.duration), modified: m.modificationTime || 0, width: m.width || 0, height: m.height || 0,
      };
    } catch (e) { return null; }
  })).filter(Boolean);
}

/** A small picture of the video (a file:// link), or null. Cached by the native side. */
export async function thumbnailFor(video) {
  if (!VIDEO_TOOLS_SUPPORTED) return null;
  try { return await AudioEditor.videoThumbnail(video.uri, 320); } catch (e) { return null; }
}
