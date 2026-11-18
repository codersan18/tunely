import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import Cover from '../components/Cover';
import { getStats, onStatsChange } from '../utils/stats';
import { usePlayer } from '../context/PlayerContext';
import { useCatalog } from '../context/CatalogContext';
import { useLocalMusic } from '../context/LocalMusicContext';

// "Your VibeRoom": this listener's top songs, artists and listening time (kept on the phone only).

const PERIODS = [
  { key: 'month', label: 'This month' },
  { key: 'year', label: 'This year' },
  { key: 'all', label: 'All time' },
];

const formatListening = (s) => {
  const m = Math.round(s / 60);
  if (m < 60) return { big: `${m}`, unit: m === 1 ? 'minute' : 'minutes' };
  const h = Math.floor(m / 60);
  return { big: `${h}h ${m % 60}m`, unit: 'listening' };
};

export default function StatsScreen({ navigation }) {
  const [period, setPeriod] = useState('month');
  const [stats, setStats] = useState(null);
  const { playTrack } = usePlayer();
  const { songs } = useCatalog();
  const local = useLocalMusic();

  useEffect(() => {
    let alive = true;
    const load = () => getStats(period).then((s) => { if (alive) setStats(s); });
    load();
    const off = onStatsChange(load);
    return () => { alive = false; off(); };
  }, [period]);

  // Play a top song: use the library's or the phone's current version of it (the saved details
  // may be old), and skip songs that no longer exist.
  const available = new Map([...songs, ...local.tracks].map((t) => [t.id, t]));
  const topList = (stats?.topSongs || []).map((r) => available.get(r.track.id)).filter(Boolean);

  const listening = formatListening(stats?.seconds || 0);
  const year = new Date().getFullYear();

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <View style={styles.top}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Pressable>
        <Text style={styles.h1}>Your VibeRoom</Text>
      </View>
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.chips}>
          {PERIODS.map((p) => (
            <Pressable key={p.key} onPress={() => setPeriod(p.key)} style={[styles.chip, period === p.key && styles.chipOn]}>
              <Text style={[styles.chipText, period === p.key && { color: colors.bg }]}>{p.key === 'year' ? `${year}` : p.label}</Text>
            </Pressable>
          ))}
        </View>

        <LinearGradient colors={['#2B4A40', '#4B2BD6']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <Text style={styles.heroBig}>{listening.big}</Text>
          <Text style={styles.heroUnit}>{listening.unit}</Text>
          <View style={styles.heroRow}>
            <View>
              <Text style={styles.heroNum}>{stats?.plays || 0}</Text>
              <Text style={styles.heroLabel}>plays</Text>
            </View>
            <View>
              <Text style={styles.heroNum}>{stats?.songCount || 0}</Text>
              <Text style={styles.heroLabel}>different songs</Text>
            </View>
          </View>
        </LinearGradient>

        {stats && !stats.plays ? (
          <Text style={styles.empty}>Play some songs and your top songs and artists will show up here.</Text>
        ) : (
          <>
            <Text style={styles.h2}>Top songs</Text>
            {(stats?.topSongs || []).map((r, i) => {
              const playable = available.get(r.track.id);
              return (
                <Pressable
                  key={r.track.id}
                  disabled={!playable}
                  onPress={() => playTrack(playable, topList)}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }, !playable && { opacity: 0.5 }]}
                >
                  <Text style={styles.rank}>{i + 1}</Text>
                  <Cover uri={playable?.artwork ?? r.track.artwork} seed={r.track.title} style={styles.art} />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={styles.title}>{r.track.title}</Text>
                    <Text numberOfLines={1} style={styles.sub}>{r.track.artist}</Text>
                  </View>
                  <Text style={styles.plays}>{r.plays} {r.plays === 1 ? 'play' : 'plays'}</Text>
                </Pressable>
              );
            })}

            <Text style={styles.h2}>Top artists</Text>
            {(stats?.topArtists || []).map((a, i) => (
              <View key={a.name} style={styles.row}>
                <Text style={styles.rank}>{i + 1}</Text>
                <Cover seed={a.name} icon="person" round size={48} />
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={styles.title}>{a.name}</Text>
                  <Text style={styles.sub}>{Math.round(a.seconds / 60)} min</Text>
                </View>
                <Text style={styles.plays}>{a.plays} {a.plays === 1 ? 'play' : 'plays'}</Text>
              </View>
            ))}
          </>
        )}
        <Text style={styles.note}>Kept on your phone only. A song counts as played after 30 seconds.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  h1: { color: colors.text, fontSize: 22, fontWeight: '800' },
  body: { paddingHorizontal: 16, paddingBottom: 40 },
  chips: { flexDirection: 'row', gap: 8, paddingVertical: 12 },
  chip: { borderRadius: 16, borderWidth: 1, borderColor: colors.textDim, paddingHorizontal: 14, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  hero: { borderRadius: 16, padding: 20 },
  heroBig: { color: '#fff', fontSize: 44, fontWeight: '900' },
  heroUnit: { color: 'rgba(255,255,255,0.85)', fontSize: 15, fontWeight: '600' },
  heroRow: { flexDirection: 'row', gap: 40, marginTop: 20 },
  heroNum: { color: '#fff', fontSize: 22, fontWeight: '800' },
  heroLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 12 },
  h2: { color: colors.text, fontSize: 19, fontWeight: '800', marginTop: 28, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7 },
  rank: { color: colors.textMuted, width: 20, textAlign: 'center', fontWeight: '700' },
  art: { width: 48, height: 48, borderRadius: 4 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  sub: { color: colors.textMuted, fontSize: 13, marginTop: 3 },
  plays: { color: colors.textMuted, fontSize: 12 },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 28, paddingHorizontal: 24 },
  note: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: 28 },
});
