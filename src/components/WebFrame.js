import React from 'react';
import { View, StyleSheet } from 'react-native';
import { IS_WEB } from '../utils/platform';
import { colors } from '../theme';

// On a computer screen, show VibeRoom as a centred column instead of stretching the phone
// layout across the whole monitor. On the phone this renders the app exactly as before.
export default function WebFrame({ children }) {
  if (!IS_WEB) return children;
  return (
    <View style={styles.page}>
      <View style={styles.column}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#050912', alignItems: 'center' },
  column: { flex: 1, width: '100%', maxWidth: 560, backgroundColor: colors.bg, overflow: 'hidden' },
});
