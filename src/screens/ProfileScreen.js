import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { useAuth } from '../context/AuthContext';
import { useLibrary } from '../context/LibraryContext';
import { useProfiles } from '../context/ProfilesContext';
import ProfileAvatar from '../components/ProfileAvatar';
import ProfileEditor from '../components/ProfileEditor';
import { confirmAction } from '../utils/platform';

// The Profile tab: the profile that's listening (picture, name: Home greets with it), Edit and
// Switch profile, what this profile holds, the account, and Log out.
function Count({ value, label }) {
  return (
    <View style={styles.count}>
      <Text style={styles.countValue}>{value}</Text>
      <Text style={styles.countLabel}>{label}</Text>
    </View>
  );
}

function Link({ icon, title, sub, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}>
      <Ionicons name={icon} size={22} color={colors.accent} />
      <View style={{ flex: 1 }}>
        <Text style={styles.linkTitle}>{title}</Text>
        {!!sub && <Text style={styles.linkSub}>{sub}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
    </Pressable>
  );
}

export default function ProfileScreen({ navigation }) {
  const { user, signOut } = useAuth();
  const { profile, profiles, switchProfile } = useProfiles();
  const { liked, playlists, downloadedTracks } = useLibrary();
  const [editing, setEditing] = useState(false);

  const logOut = () => confirmAction(
    'Log out?',
    'Every profile\'s likes, playlists and stats stay in your account; sign in again to get them back. Downloads stay on this device.',
    'Log out',
    signOut,
  );

  return (
    <LinearGradient colors={['#123528', colors.bg]} locations={[0, 0.45]} style={{ flex: 1 }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.h1}>Profile</Text>

          <View style={styles.card}>
            <ProfileAvatar avatar={profile?.avatar} size={96} photo={user?.image} name={profile?.name || ''} />
            <Text numberOfLines={1} style={styles.name}>{profile?.name}</Text>
            <View style={styles.actions}>
              <Pressable onPress={() => setEditing(true)} style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]} accessibilityRole="button">
                <Ionicons name="create-outline" size={17} color={colors.text} />
                <Text style={styles.actionText}>Edit profile</Text>
              </Pressable>
              <Pressable onPress={switchProfile} style={({ pressed }) => [styles.action, pressed && { opacity: 0.6 }]} accessibilityRole="button">
                <Ionicons name="people" size={16} color={colors.text} />
                <Text style={styles.actionText}>{profiles?.length > 1 ? 'Switch profile' : 'Add profile'}</Text>
              </Pressable>
            </View>
            <View style={styles.counts}>
              <Count value={liked.length} label="Liked" />
              <Count value={playlists.length} label={playlists.length === 1 ? 'Playlist' : 'Playlists'} />
              <Count value={downloadedTracks.length} label="Downloads" />
            </View>
          </View>

          <Text style={styles.note}>
            Likes, playlists, recently played and stats belong to this profile and show up wherever you sign in.
            Downloads are shared on this device.
          </Text>

          <View style={styles.links}>
            <Link icon="stats-chart" title="Your VibeRoom" sub="Top songs, artists and listening time" onPress={() => navigation.navigate('Stats')} />
            <Link icon="settings-outline" title="Settings" sub="Playback, equalizer and data" onPress={() => navigation.navigate('Settings')} />
          </View>

          <View style={styles.account}>
            <Ionicons name="mail-outline" size={18} color={colors.textMuted} />
            <View style={{ flex: 1 }}>
              <Text style={styles.accountLabel}>Account</Text>
              <Text numberOfLines={1} style={styles.accountEmail}>{user?.email}</Text>
            </View>
          </View>

          <Pressable onPress={logOut} style={({ pressed }) => [styles.logOut, pressed && { opacity: 0.6 }]} accessibilityRole="button">
            <Ionicons name="log-out-outline" size={20} color={colors.danger} />
            <Text style={styles.logOutText}>Log out</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
      <ProfileEditor visible={editing} profile={profile} onClose={() => setEditing(false)} />
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 140, gap: 16 },
  h1: { color: colors.text, fontSize: 26, fontWeight: '800', marginTop: 8 },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 20, alignItems: 'center' },
  name: { color: colors.text, fontSize: 22, fontWeight: '800', marginTop: 12, maxWidth: '100%' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14, flexWrap: 'wrap', justifyContent: 'center' },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: colors.surfaceHigh },
  actionText: { color: colors.text, fontSize: 14, fontWeight: '700' },
  counts: { flexDirection: 'row', marginTop: 18, alignSelf: 'stretch' },
  count: { flex: 1, alignItems: 'center' },
  countValue: { color: colors.text, fontSize: 18, fontWeight: '800' },
  countLabel: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  note: { color: colors.textMuted, fontSize: 13, lineHeight: 19, paddingHorizontal: 4 },
  links: { backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 4 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  linkTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  linkSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  accountLabel: { color: colors.textMuted, fontSize: 12 },
  accountEmail: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 2 },
  logOut: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 26, paddingVertical: 14, borderWidth: 1, borderColor: colors.danger },
  logOutText: { color: colors.danger, fontSize: 16, fontWeight: '800' },
});
