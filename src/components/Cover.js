import React from 'react';
import { Image, View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';

// Cover art, or a gradient with a music note when a song has no cover.
// The gradient colour is picked from the title so each song looks a bit different.
const PALETTE = [['#3B2A6B', '#9B7BE8'], ['#1F4D5C', '#5FC6D9'], ['#6B3A2A', '#E8A07B'], ['#2A5C3B', '#7BE8A4'], ['#5C2A4D', '#E87BC4'], ['#1E2A5C', '#7B95E8']];

const pick = (seed = '') => {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 997;
  return PALETTE[h % PALETTE.length];
};

export default function Cover({ uri, seed, size, style, round, icon = 'musical-note' }) {
  const shape = [
    size != null && { width: size, height: size },
    round && size != null && { borderRadius: size / 2 },
    style,
  ];
  if (uri) return <Image source={{ uri }} style={[styles.base, ...shape]} />;
  const [from, to] = pick(seed);
  const flat = StyleSheet.flatten(shape) || {};
  const iconSize = Math.max(16, Math.round((flat.width || size || 48) * 0.4));
  return (
    <View style={[styles.base, ...shape, { overflow: 'hidden' }]}>
      <LinearGradient colors={[from, to]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fill}>
        <Ionicons name={icon} size={iconSize} color="rgba(255,255,255,0.9)" />
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: '#26262C' },
  fill: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
