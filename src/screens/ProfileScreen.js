import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { useAuth } from '../context/AuthContext';
import { useLibrary } from '../context/LibraryContext';
import { confirmAction } from '../utils/platform';

// The Profile tab: who's signed in, what the account holds, and Log out.
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
  const { liked, playlists, downloadedTracks } = useLibrary();
  const name = user?.name || (user?.email || '').split('@')[0] || 'You';
  const initial = name.trim().charAt(0).toUpperCase() || '?';

  const logOut = () => confirmAction(
    'Log out?',
    'Your likes, playlists and stats stay in your account; sign in again to get them back. Downloads stay on this device.',
    'Log out',
    signOut,
  );

  return (
    <LinearGradient colors={['#123528', colors.bg]} locations={[0, 0.45]} style={{ flex: 1 }}>
      <SafeAreaView edges={['top']} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.h1}>Profile</Text>

          <View style={styles.card}>
            {user?.image
              ? <Image source={{ uri: user.image }} style={styles.avatar} />
              : <View style={[styles.avatar, styles.avatarEmpty]}><Text style={styles.avatarText}>{initial}</Text></View>}
            <Text numberOfLines={1} style={styles.name}>{name}</Text>
            {!!user?.email && <Text numberOfLines={1} style={styles.email}>{user.email}</Text>}
            <View style={styles.counts}>
              <Count value={liked.length} label="Liked" />
              <Count value={playlists.length} label={playlists.length === 1 ? 'Playlist' : 'Playlists'} />
              <Count value={downloadedTracks.length} label="Downloads" />
            </View>
          </View>

          <Text style={styles.note}>
            Your likes, playlists, recently played and listening stats are saved to your account and show up
            wherever you sign in. Downloads stay on each device.
          </Text>

          <View style={styles.links}>
            <Link icon="stats-chart" title="Your VibeRoom" sub="Top songs, artists and listening time" onPress={() => navigation.navigate('Stats')} />
            <Link icon="settings-outline" title="Settings" sub="Playback, equalizer and data" onPress={() => navigation.navigate('Settings')} />
          </View>

          <Pressable onPress={logOut} style={({ pressed }) => [styles.logOut, pressed && { opacity: 0.6 }]} accessibilityRole="button">
            <Ionicons name="log-out-outline" size={20} color={colors.danger} />
            <Text style={styles.logOutText}>Log out</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 140, gap: 16 },
  h1: { color: colors.text, fontSize: 26, fontWeight: '800', marginTop: 8 },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 20, alignItems: 'center' },
  avatar: { width: 88, height: 88, borderRadius: 44, marginBottom: 12 },
  avatarEmpty: { backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.bg, fontSize: 36, fontWeight: '800' },
  name: { color: colors.text, fontSize: 20, fontWeight: '800', maxWidth: '100%' },
  email: { color: colors.textMuted, fontSize: 14, marginTop: 2, maxWidth: '100%' },
  counts: { flexDirection: 'row', marginTop: 18, alignSelf: 'stretch' },
  count: { flex: 1, alignItems: 'center' },
  countValue: { color: colors.text, fontSize: 18, fontWeight: '800' },
  countLabel: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  note: { color: colors.textMuted, fontSize: 13, lineHeight: 19, paddingHorizontal: 4 },
  links: { backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 4 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  linkTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  linkSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  logOut: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 26, paddingVertical: 14, borderWidth: 1, borderColor: colors.danger },
  logOutText: { color: colors.danger, fontSize: 16, fontWeight: '800' },
});
