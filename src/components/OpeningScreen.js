import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as SplashScreen from 'expo-splash-screen';

// Keep the system splash (logo only) up until the branded screen below has drawn.
SplashScreen.preventAutoHideAsync().catch(() => {});

const SHOW_MS = 1400;

// The VibeRoom opening screen: logo pops in, name fades up, then the whole screen fades away.
export default function OpeningScreen({ onDone }) {
  const logo = useRef(new Animated.Value(0)).current;
  const name = useRef(new Animated.Value(0)).current;
  const screen = useRef(new Animated.Value(1)).current;
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    Animated.sequence([
      Animated.spring(logo, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }),
      Animated.timing(name, { toValue: 1, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.delay(SHOW_MS - 800),
      Animated.timing(screen, { toValue: 0, duration: 350, useNativeDriver: true }),
    ]).start(() => done.current?.());
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
          <Text style={styles.tag}>Your music. Your room.</Text>
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
