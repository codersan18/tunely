import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// The listener's settings, saved on the phone.
//   transitions: seconds of fade between songs (0 = off)
//   dataSaver:   on mobile data, load only a little ahead (see PlayerContext)
//   speed:       playback speed

const KEY = 'tunely:settings:v1';
export const TRANSITION_OPTIONS = [0, 3, 6, 10];
export const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2];
const DEFAULTS = { transitions: 0, dataSaver: false, speed: 1 };

const SettingsContext = createContext(null);

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULTS);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => { if (raw) setSettings({ ...DEFAULTS, ...JSON.parse(raw) }); })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const set = useCallback((patch) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const value = useMemo(() => ({ ...settings, ready, set }), [settings, ready, set]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>');
  return ctx;
}
