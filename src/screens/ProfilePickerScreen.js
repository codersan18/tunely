import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { useAuth } from '../context/AuthContext';
import { useProfiles } from '../context/ProfilesContext';
import ProfileAvatar from '../components/ProfileAvatar';
import ProfileEditor from '../components/ProfileEditor';
import LoadingScreen from '../components/LoadingScreen';

const MAX_PROFILES = 6;

// "Who's listening?": pick a profile (shown at start when the account has more than one, and from
// Profile → Switch profile). "Manage profiles" turns the tiles into edit buttons; "Add profile"
// makes a new one (up to 6).
export default function ProfilePickerScreen() {
  const { user } = useAuth();
  const { profiles, select, lastId } = useProfiles();
  const [managing, setManaging] = useState(false);
  const [editing, setEditing] = useState(undefined); // undefined = closed, null = new, profile = edit

  if (!profiles) return <LoadingScreen />;

  const open = (p) => (managing ? setEditing(p) : select(p.id));

  return (
    <LinearGradient colors={['#123528', colors.bg]} locations={[0, 0.5]} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.h1}>{managing ? 'Manage profiles' : "Who's listening?"}</Text>
          <View style={styles.grid}>
            {profiles.map((p) => (
              <Pressable key={p.id} onPress={() => open(p)} style={({ pressed }) => [styles.tile, pressed && { transform: [{ scale: 0.96 }] }]}
                accessibilityRole="button" accessibilityLabel={managing ? `Edit ${p.name}` : p.name}>
                <View style={[styles.ring, !managing && p.id === lastId && styles.ringLast]}>
                  <ProfileAvatar avatar={p.avatar} size={104} photo={user?.image} name={p.name} />
                  {managing && (
                    <View style={styles.editOverlay}>
                      <View style={styles.editBadge}>
                        <Ionicons name="create-outline" size={22} color="#FFFFFF" />
                      </View>
                    </View>
                  )}
                </View>
                <Text numberOfLines={1} style={styles.name}>{p.name}</Text>
              </Pressable>
            ))}
            {profiles.length < MAX_PROFILES && (
              <Pressable onPress={() => setEditing(null)} style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}
                accessibilityRole="button" accessibilityLabel="Add profile">
                <View style={styles.add}>
                  <Ionicons name="add" size={52} color={colors.textMuted} />
                </View>
                <Text style={[styles.name, { color: colors.textMuted }]}>Add profile</Text>
              </Pressable>
            )}
          </View>

          <Pressable onPress={() => setManaging((m) => !m)} style={({ pressed }) => [styles.manage, managing && styles.manageOn, pressed && { opacity: 0.7 }]}>
            <Ionicons name={managing ? 'checkmark' : 'settings-outline'} size={16} color={managing ? colors.bg : colors.text} />
            <Text style={[styles.manageText, managing && { color: colors.bg }]}>{managing ? 'Done' : 'Manage profiles'}</Text>
          </Pressable>
          <Text style={styles.note}>Each profile has its own likes, playlists and listening stats. Downloads are shared on this device.</Text>
        </ScrollView>
      </SafeAreaView>
      <ProfileEditor visible={editing !== undefined} profile={editing || null} onClose={() => setEditing(undefined)} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  body: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 22 },
  h1: { color: colors.text, fontSize: 28, fontWeight: '800', textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 18, maxWidth: 520 },
  tile: { width: 120, alignItems: 'center', gap: 8 },
  ring: { padding: 3, borderRadius: 24, borderWidth: 3, borderColor: 'transparent' },
  ringLast: { borderColor: 'rgba(255,255,255,0.35)' },
  editOverlay: { ...StyleSheet.absoluteFillObject, margin: 3, borderRadius: 19, backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
  editBadge: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(18,18,18,0.75)', borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  add: { width: 110, height: 110, borderRadius: 20, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.textDim, alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.text, fontSize: 15, fontWeight: '700', maxWidth: 120, textAlign: 'center' },
  manage: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 22, borderWidth: 1, borderColor: colors.textDim, paddingHorizontal: 18, paddingVertical: 10 },
  manageOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  manageText: { color: colors.text, fontWeight: '800', fontSize: 14 },
  note: { color: colors.textMuted, fontSize: 13, textAlign: 'center', maxWidth: 320, lineHeight: 19 },
});
