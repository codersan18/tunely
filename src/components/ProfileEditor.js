import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { useAuth } from '../context/AuthContext';
import { useProfiles } from '../context/ProfilesContext';
import ProfileAvatar from './ProfileAvatar';
import { AVATARS, GOOGLE_AVATAR, freeAvatar } from '../utils/avatars';
import { confirmAction } from '../utils/platform';

const NAME_MAX = 20;

// Add a profile, or change one's name and picture (and delete it, except the main profile).
// `profile`: the one to edit, or null to add a new one.
export default function ProfileEditor({ visible, profile, onClose }) {
  const { user } = useAuth();
  const { profiles, saveProfile, deleteProfile } = useProfiles();
  const adding = !profile;
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState('headphones');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    setName(profile?.name || '');
    setAvatar(profile?.avatar || freeAvatar(profiles || []));
    setError('');
    setBusy(false);
  }, [visible, profile, profiles]);

  const save = async () => {
    if (busy) return;
    if (!name.trim()) { setError('Give the profile a name.'); return; }
    setBusy(true);
    setError('');
    try {
      await saveProfile({ id: profile?.id, name: name.trim(), avatar });
      onClose();
    } catch (e) {
      setError(e.message || "Couldn't save. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = () => confirmAction(
    `Delete ${profile.name}?`,
    "This profile's likes, playlists, history and stats will be deleted. This can't be undone.",
    'Delete',
    async () => {
      setBusy(true);
      try { await deleteProfile(profile.id); onClose(); } catch (e) { setError(e.message || "Couldn't delete. Try again."); setBusy(false); }
    },
  );

  const choices = [...(user?.image ? [{ id: GOOGLE_AVATAR }] : []), ...AVATARS];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <SafeAreaView style={styles.screen}>
        <View style={styles.top}>
          <Pressable onPress={onClose} hitSlop={10} disabled={busy} accessibilityLabel="Cancel">
            <Ionicons name="close" size={28} color={colors.text} />
          </Pressable>
          <Text style={styles.h1}>{adding ? 'Add profile' : 'Edit profile'}</Text>
          <Pressable onPress={save} disabled={busy} style={({ pressed }) => [styles.save, (pressed || busy) && { opacity: 0.7 }]}>
            {busy ? <ActivityIndicator color={colors.bg} size="small" /> : <Text style={styles.saveText}>Save</Text>}
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <View style={styles.preview}>
            <ProfileAvatar avatar={avatar} size={112} photo={user?.image} name={name} />
          </View>
          <TextInput value={name} onChangeText={(t) => setName(t.replace(/[\r\n]/g, ''))} placeholder="Name" placeholderTextColor={colors.textDim}
            style={styles.input} maxLength={NAME_MAX} autoCapitalize="words" returnKeyType="done" onSubmitEditing={save}
            editable={!busy} autoFocus={adding} />
          {!!error && <Text style={styles.error}>{error}</Text>}

          <Text style={styles.h2}>Choose a picture</Text>
          <View style={styles.grid}>
            {choices.map((a) => (
              <Pressable key={a.id} onPress={() => setAvatar(a.id)} accessibilityLabel={a.id === GOOGLE_AVATAR ? 'Google photo' : a.id}
                style={[styles.choice, avatar === a.id && styles.choiceOn]}>
                <ProfileAvatar avatar={a.id} size={64} photo={user?.image} name={name} />
              </Pressable>
            ))}
          </View>

          {!adding && !profile.main && (
            <Pressable onPress={remove} disabled={busy} style={({ pressed }) => [styles.delete, pressed && { opacity: 0.6 }]}>
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
              <Text style={styles.deleteText}>Delete profile</Text>
            </Pressable>
          )}
          {!adding && profile.main && <Text style={styles.note}>This is the account's main profile, so it can't be deleted.</Text>}
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 10 },
  h1: { flex: 1, color: colors.text, fontSize: 20, fontWeight: '800' },
  save: { backgroundColor: colors.accent, borderRadius: 18, paddingHorizontal: 20, paddingVertical: 8, minWidth: 76, alignItems: 'center' },
  saveText: { color: colors.bg, fontWeight: '800', fontSize: 15 },
  body: { padding: 20, paddingBottom: 48, gap: 14, maxWidth: 560, width: '100%', alignSelf: 'center' },
  preview: { alignItems: 'center', marginBottom: 4 },
  input: { backgroundColor: colors.surfaceHigh, color: colors.text, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13, fontSize: 17, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 13, textAlign: 'center' },
  h2: { color: colors.text, fontSize: 16, fontWeight: '700', marginTop: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  choice: { padding: 3, borderRadius: 16, borderWidth: 3, borderColor: 'transparent' },
  choiceOn: { borderColor: colors.text },
  delete: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 18, paddingVertical: 12, borderRadius: 24, borderWidth: 1, borderColor: colors.danger },
  deleteText: { color: colors.danger, fontWeight: '800', fontSize: 15 },
  note: { color: colors.textMuted, fontSize: 13, textAlign: 'center', marginTop: 14 },
});
