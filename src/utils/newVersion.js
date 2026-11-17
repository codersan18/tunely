// "New version available": tells people when a new APK is out, because changes to the app's native
// code (see README → Shipping changes) can't arrive over the air.
//
// Every build has a runtime version (a fingerprint of its native code). The latest GitHub release
// says which runtime its APK has, in a hidden line of its notes: <!-- runtime: <hash> -->
// (scripts/release-apk.mjs adds it). If that's not the runtime of this app, a newer APK is out.

import { Alert, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';

const LATEST_RELEASE = 'https://api.github.com/repos/codersan18/tunely/releases/latest';
export const APK_URL = 'https://github.com/codersan18/tunely/releases/latest/download/VibeRoom.apk';
const LATER_KEY = 'tunely:newVersion:later';
const ASK_AGAIN_MS = 3 * 24 * 60 * 60 * 1000; // after "Later", ask again in 3 days

async function latestRelease() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(LATEST_RELEASE, { headers: { Accept: 'application/vnd.github+json' }, signal: ctrl.signal });
    return res.ok ? await res.json() : null;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkForNewVersion() {
  // Only installed APKs: not the website, not development, not builds without updates.
  if (Platform.OS !== 'android' || __DEV__ || !Updates.isEnabled || !Updates.runtimeVersion) return;
  try {
    const release = await latestRelease();
    const runtime = release?.body?.match(/<!--\s*runtime:\s*([0-9a-f]+)\s*-->/i)?.[1];
    if (!runtime || runtime === Updates.runtimeVersion) return;

    const later = JSON.parse((await AsyncStorage.getItem(LATER_KEY)) || 'null');
    if (later?.tag === release.tag_name && Date.now() < later.until) return;

    Alert.alert(
      'New version available',
      'A new version of VibeRoom is ready. Download it, then open the file to install. Your liked songs, playlists and downloads stay.',
      [
        {
          text: 'Later',
          style: 'cancel',
          onPress: () => AsyncStorage.setItem(LATER_KEY, JSON.stringify({ tag: release.tag_name, until: Date.now() + ASK_AGAIN_MS })).catch(() => {}),
        },
        { text: 'Download', onPress: () => Linking.openURL(APK_URL).catch(() => {}) },
      ],
    );
  } catch (e) {
    // Offline or GitHub unreachable: check again next time the app opens.
  }
}
