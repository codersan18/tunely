import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';
import { listProfiles, saveProfile as saveProfileApi, deleteProfile as deleteProfileApi } from '../api/auth';
import { setProfileScope, removeAllScopes, MAIN_PROFILE } from '../utils/profileScope';
import { clearProfileLibrary } from './LibraryContext';
import { clearStats } from '../utils/stats';

// Profiles, like Netflix: up to 6 per account, each with its own likes, playlists, recently played
// and stats (the backend keeps them; utils/profileScope.js keeps them apart on the device).
// With more than one profile the app asks "Who's listening?" when it starts; with one it goes
// straight in. The list is cached so the picker also works offline.

const LIST_KEY = 'viberoom:profiles:v1'; // { userId, profiles }
const LAST_KEY = 'viberoom:profile:v1'; // { userId, id }: the last profile used on this device
const PLAYER_KEY = 'tunely:player:v1';
const ProfilesContext = createContext(null);

export function ProfilesProvider({ children }) {
  const { user, session, expired } = useAuth();
  const [profiles, setProfiles] = useState(null); // null until known
  const [activeId, setActiveId] = useState(null); // null = show "Who's listening?"
  const [lastId, setLastId] = useState(null);
  const [switching, setSwitching] = useState(false); // the picker was opened on purpose

  const apply = useCallback((list) => {
    setProfiles(list);
    AsyncStorage.setItem(LIST_KEY, JSON.stringify({ userId: user.id, profiles: list })).catch(() => {});
    setActiveId((cur) => (cur && !list.some((p) => p.id === cur) ? null : cur)); // deleted elsewhere
  }, [user.id]);

  const select = useCallback((id) => {
    setProfileScope(id); // before the library for this profile loads
    setSwitching(false);
    setActiveId(id);
    setLastId(id);
    AsyncStorage.setItem(LAST_KEY, JSON.stringify({ userId: user.id, id })).catch(() => {});
  }, [user.id]);

  const refresh = useCallback(async () => {
    try {
      apply((await listProfiles(session)).profiles);
    } catch (e) {
      if (e.status === 401) expired();
      throw e;
    }
  }, [session, apply, expired]);

  // Start: the cached list straight away, then the account's.
  useEffect(() => {
    let alive = true;
    (async () => {
      let list = null;
      try {
        const [[, rawList], [, rawLast]] = await AsyncStorage.multiGet([LIST_KEY, LAST_KEY]);
        const cached = rawList && JSON.parse(rawList);
        if (cached?.userId === user.id) list = cached.profiles;
        const last = rawLast && JSON.parse(rawLast);
        if (last?.userId === user.id) setLastId(last.id);
      } catch (e) { /* nothing cached */ }
      if (list && alive) setProfiles(list);
      try {
        list = (await listProfiles(session)).profiles;
        if (alive) apply(list);
      } catch (e) {
        if (e.status === 401) { expired(); return; }
        // Offline the first time: just the main profile until the account can be reached.
        if (!list && alive) {
          list = [{ id: MAIN_PROFILE, name: (user.nickname || (user.name || '').split(' ')[0] || 'Me'), avatar: user.image ? 'google' : 'headphones', main: true }];
          setProfiles(list);
        }
      }
    })();
    return () => { alive = false; };
  }, [user.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only one profile: no need to ask who's listening, unless the person opened the picker on
  // purpose (Switch / Add profile).
  useEffect(() => {
    if (!switching && !activeId && profiles?.length === 1) select(profiles[0].id);
  }, [profiles, activeId, select, switching]);

  const saveProfile = useCallback(async (profile) => {
    const { profiles: list } = await saveProfileApi(session, profile);
    apply(list);
    return list;
  }, [session, apply]);

  const deleteProfile = useCallback(async (id) => {
    const { profiles: list } = await deleteProfileApi(session, id);
    apply(list);
    // Its likes, playlists, stats and queue on this device go too (downloads stay).
    clearProfileLibrary(id);
    clearStats(id);
    removeAllScopes([PLAYER_KEY], id);
    return list;
  }, [session, apply]);

  const value = useMemo(() => ({
    profiles,
    profile: profiles?.find((p) => p.id === activeId) || null,
    lastId,
    select,
    switchProfile: () => { setSwitching(true); setActiveId(null); },
    saveProfile,
    deleteProfile,
    refresh,
    // The library sync found this profile deleted on another device.
    gone: () => { refresh().catch(() => {}); setActiveId(null); },
  }), [profiles, activeId, lastId, select, saveProfile, deleteProfile, refresh]);

  return <ProfilesContext.Provider value={value}>{children}</ProfilesContext.Provider>;
}

export function useProfiles() {
  const ctx = useContext(ProfilesContext);
  if (!ctx) throw new Error('useProfiles must be used inside <ProfilesProvider>');
  return ctx;
}
