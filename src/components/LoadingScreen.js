import React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';

// The one "please wait" screen between signing in and the app: finishing a Google sign-in and
// loading the profiles look the same, so the screen doesn't flicker from one to the other.
export default function LoadingScreen({ message = '', onCancel = null }) {
  return (
    <View style={styles.screen}>
      <View style={styles.logo}>
        <Ionicons name="musical-notes" size={34} color={colors.bg} />
      </View>
      <ActivityIndicator color={colors.accent} size="large" />
      <Text style={styles.msg}>{message || ' '}</Text>
      {onCancel ? (
        <Pressable onPress={onCancel} hitSlop={10} style={styles.cancel} accessibilityRole="button">
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
      ) : <View style={styles.cancel} />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24 },
  logo: { width: 68, height: 68, borderRadius: 18, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  msg: { color: colors.textMuted, fontSize: 15, textAlign: 'center', minHeight: 20 },
  cancel: { minHeight: 36, justifyContent: 'center' },
  cancelText: { color: colors.accent, fontSize: 15, fontWeight: '800' },
});
