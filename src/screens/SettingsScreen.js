import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, Switch, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import { colors } from '../theme';
import { useSettings, TRANSITION_OPTIONS, SPEED_OPTIONS } from '../context/SettingsContext';
import EqualizerSheet from '../components/EqualizerSheet';
import { EQ_AVAILABLE, DATA_SAVER_AVAILABLE } from '../utils/playerExtras';
import { presetName } from '../utils/eqPresets';
import { useAuth } from '../context/AuthContext';
import { confirmAction } from '../utils/platform';

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Chips({ options, value, label, onChange }) {
  return (
    <View style={styles.chips}>
      {options.map((o) => (
        <Pressable key={o} onPress={() => onChange(o)} style={[styles.chip, value === o && styles.chipOn]}>
          <Text style={[styles.chipText, value === o && { color: colors.bg }]}>{label(o)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Link({ icon, title, sub, onPress }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}>
      <Ionicons name={icon} size={22} color={colors.accent} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {!!sub && <Text style={styles.rowSub}>{sub}</Text>}
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textDim} />
    </Pressable>
  );
}

export default function SettingsScreen({ navigation }) {
  const { transitions, dataSaver, speed, eqOn, eqBands, set } = useSettings();
  const [eqMenu, setEqMenu] = useState(false);
  const { user, signOut } = useAuth();
  const initial = (user?.name || user?.email || '?').trim().charAt(0).toUpperCase();

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <View style={styles.top}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Pressable>
        <Text style={styles.h1}>Settings</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <Section title="Account">
          <View style={styles.account}>
            {user?.image
              ? <Image source={{ uri: user.image }} style={styles.avatar} />
              : <View style={[styles.avatar, styles.avatarEmpty]}><Text style={styles.avatarText}>{initial}</Text></View>}
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={styles.rowTitle}>{user?.name || 'Your account'}</Text>
              <Text numberOfLines={1} style={styles.rowSub}>{user?.email || ''}</Text>
            </View>
          </View>
          <Text style={styles.rowSub}>Your likes, playlists, recently played and listening stats are saved to this account and show up wherever you sign in. Downloads stay on each device.</Text>
          <Pressable
            onPress={() => confirmAction('Sign out?', 'Your likes and playlists stay in your account. Downloads stay on this device.', 'Sign out', signOut)}
            style={({ pressed }) => [styles.signOut, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="log-out-outline" size={18} color={colors.danger} />
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </Section>

        <Section title="Playback">
          <Text style={styles.rowTitle}>Smooth transitions</Text>
          <Text style={styles.rowSub}>Each song fades out at the end and the next one fades in.</Text>
          <Chips options={TRANSITION_OPTIONS} value={transitions} label={(s) => (s ? `${s} s` : 'Off')} onChange={(s) => set({ transitions: s })} />

          <Text style={[styles.rowTitle, { marginTop: 18 }]}>Playback speed</Text>
          <Text style={styles.rowSub}>Also in the player (the speed button).</Text>
          <Chips options={SPEED_OPTIONS} value={speed} label={(s) => `${s}×`} onChange={(s) => set({ speed: s })} />

          {EQ_AVAILABLE && (
            <View style={{ marginTop: 10 }}>
              <Link icon="options-outline" title="Equalizer" sub={eqOn ? `On · ${presetName(eqBands)}` : 'Off · bass, treble and presets'} onPress={() => setEqMenu(true)} />
            </View>
          )}
        </Section>

        {DATA_SAVER_AVAILABLE && (
          <Section title="Data">
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Data saver</Text>
                <Text style={styles.rowSub}>
                  On mobile data, load only a little ahead instead of the whole song and the next one.
                  Uses less data; songs may pause on a weak signal. Wi-Fi is not affected.
                </Text>
              </View>
              <Switch
                value={dataSaver}
                onValueChange={(v) => set({ dataSaver: v })}
                trackColor={{ true: colors.accentDark, false: colors.surfaceHigh }}
                thumbColor={dataSaver ? colors.accent : colors.textMuted}
              />
            </View>
          </Section>
        )}

        <Section title="More">
          <Link icon="stats-chart" title="Your VibeRoom" sub="Your top songs, artists and listening time" onPress={() => navigation.navigate('Stats')} />
          <Link icon="chatbubble-ellipses-outline" title="Ask for a song" sub="Can't find a song? Ask for it to be added" onPress={() => navigation.navigate('Request')} />
        </Section>

        {!!Updates.runtimeVersion && (
          <Text style={styles.version}>
            VibeRoom · build {Updates.runtimeVersion.slice(0, 7)}{Updates.updateId ? ` · update ${Updates.updateId.slice(0, 8)}` : ''}
          </Text>
        )}
      </ScrollView>
      {EQ_AVAILABLE && <EqualizerSheet visible={eqMenu} onClose={() => setEqMenu(false)} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  h1: { color: colors.text, fontSize: 22, fontWeight: '800' },
  body: { padding: 16, paddingBottom: 40, gap: 16 },
  section: { backgroundColor: colors.surface, borderRadius: 12, padding: 16 },
  sectionTitle: { color: colors.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 12 },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  rowSub: { color: colors.textMuted, fontSize: 13, marginTop: 4, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: { borderRadius: 16, borderWidth: 1, borderColor: colors.textDim, paddingHorizontal: 14, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 6 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  avatarEmpty: { backgroundColor: colors.accentDark, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.accent, fontSize: 20, fontWeight: '800' },
  signOut: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginTop: 12, borderRadius: 18, borderWidth: 1, borderColor: colors.danger, paddingHorizontal: 14, paddingVertical: 7 },
  signOutText: { color: colors.danger, fontWeight: '700', fontSize: 14 },
  version: { color: colors.textDim, fontSize: 12, textAlign: 'center' },
});
