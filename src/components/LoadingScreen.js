import React from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { colors } from '../theme';

// The one "please wait" screen between signing in and the app: finishing a Google sign-in and
// loading the profiles look the same, so the screen doesn't flicker from one to the other.
export default function LoadingScreen({ message = '', onCancel = null }) {
  return (
    <View style={styles.screen}>
      <View style={styles.logo}>
        {/* A plain character, not an icon font: shows at once, also on the web (and matches public/app-return.html). */}
        <Text style={styles.note} allowFontScaling={false}>♫</Text>
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
  note: { color: colors.bg, fontSize: 38, lineHeight: 46, fontWeight: '700', textAlign: 'center' },
  msg: { color: colors.textMuted, fontSize: 15, textAlign: 'center', minHeight: 20 },
  cancel: { minHeight: 36, justifyContent: 'center' },
  cancelText: { color: colors.accent, fontSize: 15, fontWeight: '800' },
});
