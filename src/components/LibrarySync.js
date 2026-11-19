import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useLibrary } from '../context/LibraryContext';
import { syncLibrary } from '../api/auth';
import { exportStats, setRemoteStats } from '../utils/stats';
import { getDeviceId } from '../utils/device';
import { getProfileScope } from '../utils/profileScope';
import { useProfiles } from '../context/ProfilesContext';

const AFTER_CHANGE_MS = 3000;
const EVERY_MS = 3 * 60 * 1000;

// Keeps likes, playlists, recently played and listening stats the same on every device signed in
// to the account. Sends this device's state; the server merges (backend: mergeLibrary) and sends
// back the result, which replaces the library here (downloads and this device's own songs stay).
export default function LibrarySync() {
  const { session, expired } = useAuth();
  const { gone } = useProfiles();
  const { ready, syncState, applySync } = useLibrary();
  const stateRef = useRef(syncState); stateRef.current = syncState;
  const lastSynced = useRef(null); // the library as of the last sync, to skip syncing nothing new
  const running = useRef(false);
  const again = useRef(false);

  const sync = useCallback(async () => {
    if (!session || !ready) return;
    if (running.current) { again.current = true; return; }
    running.current = true;
    try {
      const body = { deviceId: await getDeviceId(), profileId: getProfileScope(), ...stateRef.current, stats: await exportStats() };
      const merged = await syncLibrary(session, body);
      applySync(merged);
      setRemoteStats(merged.statsOthers);
      lastSynced.current = JSON.stringify({ liked: merged.liked, playlists: merged.playlists, removed: merged.removed });
    } catch (e) {
      if (e.status === 401) expired(); // signed out elsewhere
      if (e.status === 404 && e.code === 'no_profile') gone(); // this profile was deleted on another device
      // offline: try again later
    } finally {
      running.current = false;
      if (again.current) { again.current = false; setTimeout(sync, 500); }
    }
  }, [session, ready, applySync, expired, gone]);

  // On start, then regularly, and when the app comes back or goes to the background.
  useEffect(() => {
    if (!ready || !session) return undefined;
    sync();
    const timer = setInterval(sync, EVERY_MS);
    const sub = AppState.addEventListener('change', () => sync());
    return () => { clearInterval(timer); sub.remove(); };
  }, [ready, session, sync]);

  // A few seconds after a like, playlist change or play.
  useEffect(() => {
    if (!ready || !session) return undefined;
    const mine = JSON.stringify({ liked: syncState.liked, playlists: syncState.playlists, removed: syncState.removed });
    if (mine === lastSynced.current) return undefined; // just applied from the server
    const t = setTimeout(sync, AFTER_CHANGE_MS);
    return () => clearTimeout(t);
  }, [ready, session, syncState, sync]);

  return null;
}
