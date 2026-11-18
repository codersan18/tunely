import React from 'react';
import { View, Text, Pressable, StyleSheet, Switch } from 'react-native';
import { colors } from '../theme';
import Sheet from './Sheet';
import Slider from './Slider';
import { useSettings } from '../context/SettingsContext';
import { usePlayer } from '../context/PlayerContext';
import { EQ_BANDS } from '../../modules/audio-editor';
import { EQ_PRESETS, presetName } from '../utils/eqPresets';

const db = (v) => `${v > 0 ? '+' : ''}${v} dB`;

// Equalizer for songs as they play: on/off, presets and 5 bands. Changes are heard straight away
// and are remembered (SettingsContext). Opened from the player (EQ button) and from Settings.
export default function EqualizerSheet({ visible, onClose }) {
  const { eqOn, eqBands, set } = useSettings();
  const { eqStatus } = usePlayer();
  const bands = eqBands || [0, 0, 0, 0, 0];
  const preset = presetName(bands);
  const setBands = (b) => set({ eqBands: b, eqOn: true });

  return (
    <Sheet visible={visible} onClose={onClose}>
      <View style={styles.body}>
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Equalizer</Text>
            <Text style={styles.sub}>{eqOn ? preset : 'Off'}</Text>
          </View>
          <Switch
            value={!!eqOn}
            onValueChange={(v) => set({ eqOn: v })}
            trackColor={{ true: colors.accentDark, false: colors.surfaceHigh }}
            thumbColor={eqOn ? colors.accent : colors.textMuted}
          />
        </View>

        {eqStatus && eqStatus.supported === false && eqOn && (
          <Text style={styles.warn}>Your phone didn't let VibeRoom use its equalizer. It may work once a song is playing.</Text>
        )}

        <View style={[styles.chips, !eqOn && styles.dim]}>
          {EQ_PRESETS.map((p) => {
            const on = eqOn && preset === p.name;
            return (
              <Pressable key={p.name} onPress={() => setBands(p.eq)} style={[styles.chip, on && styles.chipOn]}>
                <Text style={[styles.chipText, on && { color: colors.bg }]}>{p.name}</Text>
              </Pressable>
            );
          })}
        </View>

        <View style={!eqOn && styles.dim}>
          {EQ_BANDS.map((band, i) => (
            <View key={band}>
              <View style={styles.sliderHead}>
                <Text style={styles.label}>{band}{i === 0 ? '  · bass' : i === EQ_BANDS.length - 1 ? '  · treble' : ''}</Text>
                <Text style={styles.value}>{db(bands[i])}</Text>
              </View>
              <Slider value={bands[i]} min={-12} max={12} step={1} center
                onChange={(v) => setBands(bands.map((x, j) => (j === i ? v : x)))} />
            </View>
          ))}
        </View>
        <Text style={styles.note}>Applies to every song you play, until you turn it off.</Text>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 8 },
  head: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  title: { color: colors.text, fontSize: 18, fontWeight: '800' },
  sub: { color: colors.accent, fontSize: 13, fontWeight: '600', marginTop: 2 },
  warn: { color: colors.danger, fontSize: 12, marginBottom: 6, lineHeight: 17 },
  dim: { opacity: 0.45 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 },
  chip: { borderRadius: 16, borderWidth: 1, borderColor: colors.textDim, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  sliderHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 6 },
  label: { color: colors.text, fontSize: 14, fontWeight: '600' },
  value: { color: colors.textMuted, fontSize: 13, fontVariant: ['tabular-nums'] },
  note: { color: colors.textDim, fontSize: 12, marginTop: 10 },
});
