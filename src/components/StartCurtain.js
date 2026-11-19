import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useCatalog } from '../context/CatalogContext';
import { useLibrary } from '../context/LibraryContext';
import LoadingScreen from './LoadingScreen';

const MAX_WAIT_MS = 6000; // never hold the app longer than this
const COVERS_WAIT_MS = 800; // time allowed for the first covers once the lists are in
const FADE_MS = 220;

// Covers the app with the loading screen until Home has what it shows (the songs, "Popular this
// week" and the first covers), then fades into it, so Home appears whole instead of building
// itself (sections popping in and jumping, covers appearing one by one) right after signing in or
// switching profile.
export default function StartCurtain() {
  const { ready, popular, songs } = useCatalog();
  const { recent } = useLibrary();
  const { justSignedIn } = useAuth();
  const [phase, setPhase] = useState('up'); // up | fading | gone
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const t = setTimeout(() => setPhase((p) => (p === 'up' ? 'fading' : p)), MAX_WAIT_MS);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!ready || phase !== 'up') return undefined;
    let alive = true;
    const covers = [...new Set([...recent.slice(0, 4), ...popular.slice(0, 4), ...songs.slice(0, 4)]
      .map((t) => (typeof t?.artwork === 'string' && /^https?:/.test(t.artwork) ? t.artwork : null))
      .filter(Boolean))];
    const loaded = Promise.all(covers.map((u) => Promise.resolve(Image.prefetch?.(u)).catch(() => {})));
    Promise.race([loaded, new Promise((r) => setTimeout(r, COVERS_WAIT_MS))])
      .then(() => { if (alive) setPhase((p) => (p === 'up' ? 'fading' : p)); });
    return () => { alive = false; };
  }, [ready]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== 'fading') return;
    Animated.timing(opacity, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start(() => setPhase('gone'));
  }, [phase, opacity]);

  if (phase === 'gone') return null;
  return (
    <Animated.View pointerEvents={phase === 'up' ? 'auto' : 'none'} style={[StyleSheet.absoluteFill, { opacity }]}>
      <LoadingScreen message={justSignedIn ? 'Signing you in…' : ''} />
    </Animated.View>
  );
}
