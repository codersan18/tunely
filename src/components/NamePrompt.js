import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { colors } from '../theme';

// Small dialog asking for a name (used for new / renamed playlists).
export default function NamePrompt({ visible, title, initialValue = '', confirmLabel = 'Create', onCancel, onConfirm }) {
  const [value, setValue] = useState(initialValue);
  useEffect(() => { if (visible) setValue(initialValue); }, [visible, initialValue]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.backdrop}>
        <View style={styles.box}>
          <Text style={styles.title}>{title}</Text>
          <TextInput
            value={value}
            onChangeText={setValue}
            autoFocus
            placeholder="My Playlist"
            placeholderTextColor={colors.textDim}
            style={styles.input}
            selectionColor={colors.accent}
            onSubmitEditing={() => onConfirm(value)}
          />
          <View style={styles.row}>
            <Pressable onPress={onCancel} style={[styles.btn, styles.ghost]}>
              <Text style={styles.ghostText}>Cancel</Text>
            </Pressable>
            <Pressable onPress={() => onConfirm(value)} style={[styles.btn, styles.primary]}>
              <Text style={styles.primaryText}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', padding: 28 },
  box: { backgroundColor: colors.surface, borderRadius: 12, padding: 20 },
  title: { color: colors.text, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  input: { color: colors.text, fontSize: 22, fontWeight: '700', borderBottomWidth: 1, borderBottomColor: colors.textMuted, paddingVertical: 10, marginVertical: 24, textAlign: 'center' },
  row: { flexDirection: 'row', justifyContent: 'center', gap: 12 },
  btn: { borderRadius: 24, paddingHorizontal: 24, paddingVertical: 10 },
  ghost: { borderWidth: 1, borderColor: colors.textMuted },
  ghostText: { color: colors.text, fontWeight: '700' },
  primary: { backgroundColor: colors.accent },
  primaryText: { color: colors.bg, fontWeight: '800' },
});
