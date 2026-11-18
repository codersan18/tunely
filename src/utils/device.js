// A random ID for this install, so the server can count a listener's plays and requests without
// knowing who they are. Nothing personal is in it.

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'tunely:device:v1';
let cached = null;

export async function getDeviceId() {
  if (cached) return cached;
  try {
    cached = await AsyncStorage.getItem(KEY);
    if (!cached) {
      cached = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
      await AsyncStorage.setItem(KEY, cached);
    }
  } catch (e) {
    cached = cached || `d${Math.random().toString(36).slice(2, 12)}`;
  }
  return cached;
}
