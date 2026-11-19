import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as SplashScreen from 'expo-splash-screen';
import * as Updates from 'expo-updates';

// Keep the system splash (logo only) up until the branded screen below has drawn.
SplashScreen.preventAutoHideAsync().catch(() => {});

const SHOW_MS = 1400;
const UPDATE_WAIT_MS = 5000; // never hold the opening screen longer than this for an update check

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);

// While the opening screen shows, look for a new app update and switch to it straight away,
// so people get new features on this launch instead of the next one.
async function applyUpdateIfAny(onUpdating) {
  if (__DEV__ || !Updates.isEnabled) return;
  try {
    const check = await withTimeout(Updates.checkForUpdateAsync(), UPDATE_WAIT_MS);
    if (!check?.isAvailable) return;
    onUpdating();
    const fetched = await withTimeout(Updates.fetchUpdateAsync(), UPDATE_WAIT_MS * 2);
    if (fetched?.isNew) await Updates.reloadAsync();
  } catch (e) {
    // Offline or server unreachable: carry on with the version we have.
  }
}

// The VibeRoom opening screen: logo pops in, name fades up, then the whole screen fades away.
export default function OpeningScreen({ onDone }) {
  const logo = useRef(new Animated.Value(0)).current;
  const name = useRef(new Animated.Value(0)).current;
  const screen = useRef(new Animated.Value(1)).current;
  const done = useRef(onDone);
  done.current = onDone;
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    const intro = new Promise((resolve) => {
      Animated.sequence([
        Animated.spring(logo, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }),
        Animated.timing(name, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.delay(SHOW_MS - 800),
      ]).start(resolve);
    });
    // If an update is found the app reloads inside applyUpdateIfAny; otherwise fade into the app.
    Promise.all([intro, applyUpdateIfAny(() => setUpdating(true))]).then(() => {
      Animated.timing(screen, { toValue: 0, duration: 350, useNativeDriver: true }).start(() => done.current?.());
    });
  }, [logo, name, screen]);

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, { opacity: screen }]}
      onLayout={() => SplashScreen.hide()}
      pointerEvents="none"
    >
      <LinearGradient colors={['#14254A', '#0A1226', '#070D1E']} style={styles.fill}>
        <Animated.Image
          source={require('../../assets/logo-mark.png')}
          style={[styles.logo, {
            opacity: logo,
            transform: [{ scale: logo.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
          }]}
        />
        <Animated.View style={{
          opacity: name,
          transform: [{ translateY: name.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
          alignItems: 'center',
        }}>
          <Text style={styles.name}>
            VIBE<Text style={styles.dot}>·</Text><Text style={styles.room}>ROOM</Text>
          </Text>
          <Text style={styles.tag}>{updating ? 'Getting the latest version…' : 'Your music. Your room.'}</Text>
        </Animated.View>
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  logo: { width: 220, height: 220, marginBottom: 8 },
  name: { color: '#FFFFFF', fontSize: 38, fontWeight: '900', letterSpacing: 3 },
  dot: { color: '#FF8A3D' },
  room: { color: '#FF8A3D' },
  tag: { color: 'rgba(255,255,255,0.6)', fontSize: 14, marginTop: 10, letterSpacing: 1 },
});
