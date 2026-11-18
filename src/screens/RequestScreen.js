import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { sendSongRequest } from '../api/catalog';
import { getDeviceId } from '../utils/device';

// "Ask for a song": a listener asks for a song to be added. The admin sees it in Manage songs → Requests.
export default function RequestScreen({ navigation, route }) {
  const [title, setTitle] = useState(route.params?.title || '');
  const [artist, setArtist] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  const send = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await sendSongRequest(await getDeviceId(), { title: title.trim(), artist: artist.trim(), note: note.trim() });
      setSent(true);
    } catch (e) {
      setError(e.data?.message || 'Couldn\'t send it. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Ionicons name="chevron-down" size={28} color={colors.text} />
        </Pressable>
        <Text style={styles.topTitle}>Ask for a song</Text>
        <View style={{ width: 28 }} />
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {sent ? (
          <View style={styles.done}>
            <Ionicons name="checkmark-circle" size={64} color={colors.accent} />
            <Text style={styles.doneTitle}>Request sent</Text>
            <Text style={styles.doneText}>If "{title.trim()}" is added, it will show up in the library for everyone.</Text>
            <Pressable onPress={() => { setSent(false); setTitle(''); setArtist(''); setNote(''); }} style={styles.secondary}>
              <Text style={styles.secondaryText}>Ask for another song</Text>
            </Pressable>
            <Pressable onPress={() => navigation.goBack()} style={styles.primary}>
              <Text style={styles.primaryText}>Done</Text>
            </Pressable>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.intro}>Can't find a song? Tell us which one, and it may be added to the library.</Text>
            <Text style={styles.label}>Song title *</Text>
            <TextInput value={title} onChangeText={setTitle} placeholder="e.g. Kannaana Kanney" placeholderTextColor={colors.textDim} style={styles.input} maxLength={120} />
            <Text style={styles.label}>Artist or movie</Text>
            <TextInput value={artist} onChangeText={setArtist} placeholder="Optional" placeholderTextColor={colors.textDim} style={styles.input} maxLength={120} />
            <Text style={styles.label}>Anything else?</Text>
            <TextInput value={note} onChangeText={setNote} placeholder="Optional, e.g. the movie version" placeholderTextColor={colors.textDim}
              style={[styles.input, { height: 88, textAlignVertical: 'top' }]} multiline maxLength={300} />
            {!!error && <Text style={styles.error}>{error}</Text>}
            <Pressable onPress={send} disabled={!title.trim() || busy} style={[styles.primary, (!title.trim() || busy) && { opacity: 0.5 }]}>
              {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.primaryText}>Send request</Text>}
            </Pressable>
          </ScrollView>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  topTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  body: { padding: 20, gap: 6 },
  intro: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginBottom: 12 },
  label: { color: colors.textMuted, fontSize: 12, fontWeight: '700', marginTop: 10 },
  input: { backgroundColor: colors.surfaceHigh, color: colors.text, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  error: { color: colors.danger, marginTop: 10 },
  primary: { marginTop: 20, backgroundColor: colors.accent, borderRadius: 24, paddingVertical: 14, alignItems: 'center', alignSelf: 'stretch' },
  primaryText: { color: colors.bg, fontWeight: '800', fontSize: 15 },
  secondary: { marginTop: 24, paddingVertical: 10 },
  secondaryText: { color: colors.accent, fontWeight: '700' },
  done: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 },
  doneTitle: { color: colors.text, fontSize: 22, fontWeight: '800', marginTop: 8 },
  doneText: { color: colors.textMuted, textAlign: 'center', lineHeight: 20 },
});
