import React from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { usePlayer } from '../context/PlayerContext';

// Tap to cycle: off -> shuffle -> smart shuffle -> off. Smart shuffle shows a sparkle.
export default function ShuffleButton({ size = 26, idleColor = colors.text }) {
  const { shuffleMode, toggleShuffle } = usePlayer();
  const on = shuffleMode !== 'off';
  const label = { off: 'Shuffle off', on: 'Shuffle on', smart: 'Smart shuffle on' }[shuffleMode];
  return (
    <Pressable onPress={toggleShuffle} hitSlop={10} accessibilityRole="button" accessibilityLabel={label}>
      <View>
        <Ionicons name="shuffle" size={size} color={on ? colors.accent : idleColor} />
        {shuffleMode === 'smart' && (
          <View style={[styles.badge, { top: -size * 0.22, right: -size * 0.28 }]}>
            <Ionicons name="sparkles" size={Math.round(size * 0.5)} color={colors.accent} />
          </View>
        )}
        {on && <View style={styles.dot} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: { position: 'absolute' },
  dot: { position: 'absolute', bottom: -7, alignSelf: 'center', width: 4, height: 4, borderRadius: 2, backgroundColor: colors.accent },
});
