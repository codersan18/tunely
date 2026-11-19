// Which profile's data this device is using (profiles: context/ProfilesContext.js). Each profile has
// its own likes, playlists, recently played, stats and player queue on the device; downloads are
// shared. The main profile keeps the storage keys from before profiles, so nothing moves for it.
import AsyncStorage from '@react-native-async-storage/async-storage';

export const MAIN_PROFILE = 'main';
let current = MAIN_PROFILE;

export const setProfileScope = (id) => { current = id || MAIN_PROFILE; };
export const getProfileScope = () => current;

/** The storage key for the current profile: the key itself for main, `key@<profile>` otherwise. */
export const scoped = (key) => (current === MAIN_PROFILE ? key : `${key}@${current}`);

/** Remove a key for every profile (signing out, or a profile being deleted when `only` is given). */
export async function removeAllScopes(keys, only = null) {
  try {
    const all = await AsyncStorage.getAllKeys();
    const doomed = all.filter((k) => keys.some((base) => (only
      ? k === (only === MAIN_PROFILE ? base : `${base}@${only}`)
      : k === base || k.startsWith(`${base}@`))));
    if (doomed.length) await AsyncStorage.multiRemove(doomed);
  } catch (e) { /* nothing saved */ }
}
