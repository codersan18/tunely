import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, TextInput, BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import AudioEditor, { EQ_BANDS } from '../../modules/audio-editor';
import Waveform, { MIN_CUT_MS } from '../components/Waveform';
import Slider from '../components/Slider';
import Sheet, { SheetItem } from '../components/Sheet';
import { usePlayer } from '../context/PlayerContext';
import { SOUND_KINDS, SAVE_OPTIONS, SAVE_NOTE, setPhoneSound } from '../utils/phoneSounds';
import { toast } from '../utils/platform';
import { EQ_PRESETS, FLAT, presetName } from '../utils/eqPresets';

// Audio editor: cut a song, shape its sound, and save it on the phone as a ringtone, alarm,
// notification sound or just a new file. Everything runs on the phone (modules/audio-editor).

const FADES = [0, 1000, 2000, 3000, 5000];
const LENGTHS = [5000, 10000, 20000, 30000, 40000];
const PRESETS = EQ_PRESETS;
const SAVE_AS = SAVE_OPTIONS;

// 83500 ms -> "1:23.5"
const clock = (ms) => {
  const t = Math.max(0, Math.round(ms / 100));
  const m = Math.floor(t / 600);
  const s = Math.floor((t % 600) / 10);
  return `${m}:${String(s).padStart(2, '0')}.${t % 10}`;
};
const db = (v) => `${v > 0 ? '+' : ''}${v} dB`;

function Chips({ options, value, label, onChange }) {
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = value === o;
        return (
          <Pressable key={String(o)} onPress={() => onChange(o)} style={[styles.chip, on && styles.chipOn]}>
            <Text style={[styles.chipText, on && { color: colors.bg }]}>{label(o)}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function Nudge({ label, ms, onMinus, onPlus }) {
  return (
    <View style={styles.nudge}>
      <Text style={styles.nudgeLabel}>{label}</Text>
      <View style={styles.nudgeRow}>
        <Pressable onPress={onMinus} hitSlop={8} style={styles.nudgeBtn}><Ionicons name="remove" size={16} color={colors.text} /></Pressable>
        <Text style={styles.nudgeTime}>{clock(ms)}</Text>
        <Pressable onPress={onPlus} hitSlop={8} style={styles.nudgeBtn}><Ionicons name="add" size={16} color={colors.text} /></Pressable>
      </View>
    </View>
  );
}

export default function EditorScreen({ navigation, route }) {
  const source = route.params?.source || {};
  const { pause } = usePlayer();

  const [phase, setPhase] = useState('loading'); // loading | ready | error
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [peaks, setPeaks] = useState([]);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [gainDb, setGainDb] = useState(0);
  const [eq, setEq] = useState(FLAT);
  const [preview, setPreview] = useState(null); // null | { positionMs }
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState(`${source.title || 'My sound'} (edit)`);
  const [saving, setSaving] = useState(null); // null | kind
  const [saved, setSaved] = useState(null);   // result of exportEdit

  const params = { gainDb, eq, fadeInMs: fadeIn, fadeOutMs: fadeOut };
  const paramsRef = useRef(params); paramsRef.current = params;
  const previewing = preview !== null;

  // Read the song: its length and loudness outline.
  const load = useCallback(() => {
    setPhase('loading'); setProgress(0);
    AudioEditor.analyze(source.uri)
      .then((r) => {
        setPeaks(r.peaks);
        setDuration(r.durationMs);
        setStart(0);
        setEnd(r.durationMs <= 40000 ? r.durationMs : 30000);
        setPhase('ready');
      })
      .catch((e) => {
        if (e.code === 'ERR_CANCELLED') return;
        setError(e.message || 'VibeRoom could not read this file.');
        setPhase('error');
      });
  }, [source.uri]);

  useEffect(() => {
    const subs = [
      AudioEditor.addListener('onProgress', (e) => setProgress(e.progress)),
      AudioEditor.addListener('onPreviewProgress', (e) => setPreview((p) => (p ? { positionMs: e.positionMs } : p))),
      AudioEditor.addListener('onPreviewEnd', (e) => {
        setPreview(null);
        if (e.error) toast(`Couldn't play: ${e.error}`);
      }),
    ];
    load();
    return () => {
      subs.forEach((s) => s.remove());
      AudioEditor.stopPreview();
      AudioEditor.cancel();
    };
  }, [load]);

  // Sound changes are heard straight away while the preview plays.
  useEffect(() => {
    if (previewing) AudioEditor.updatePreview(paramsRef.current);
  }, [gainDb, eq, fadeIn, fadeOut]); // eslint-disable-line react-hooks/exhaustive-deps

  const stopPreview = useCallback(() => { AudioEditor.stopPreview(); setPreview(null); }, []);

  const togglePreview = () => {
    if (previewing) { stopPreview(); return; }
    pause();
    AudioEditor.startPreview(source.uri, start, end, paramsRef.current);
    setPreview({ positionMs: start });
  };

  const setCut = (s, e) => { setStart(s); setEnd(e); };
  const nudgeStart = (d) => { stopPreview(); setStart((s) => Math.min(Math.max(s + d, 0), end - MIN_CUT_MS)); };
  const nudgeEnd = (d) => { stopPreview(); setEnd((e) => Math.max(Math.min(e + d, duration), start + MIN_CUT_MS)); };
  const setLength = (len) => {
    stopPreview();
    if (start + len <= duration) setEnd(start + len);
    else { setStart(Math.max(0, duration - len)); setEnd(duration); }
  };
  const markStart = () => {
    if (!preview) return;
    const p = Math.min(preview.positionMs, end - MIN_CUT_MS);
    stopPreview(); setStart(Math.max(0, Math.round(p)));
  };
  const markEnd = () => {
    if (!preview) return;
    const p = Math.max(preview.positionMs, start + MIN_CUT_MS);
    stopPreview(); setEnd(Math.min(duration, Math.round(p)));
  };

  const preset = presetName(eq);
  const changed = gainDb !== 0 || fadeIn || fadeOut || preset !== 'Flat';
  const reset = () => { setGainDb(0); setFadeIn(0); setFadeOut(0); setEq(FLAT); };

  const doSave = async (kind) => {
    stopPreview();
    setSaving(kind); setProgress(0);
    try {
      const r = await AudioEditor.exportEdit(source.uri, {
        ...paramsRef.current, startMs: start, endMs: end, name: name.trim() || source.title || 'My sound',
        artist: source.artist || '', kind,
      });
      setSaveOpen(false);
      setSaved(r);
      if (kind !== 'music') setPhoneSound(r.uri, kind, null, r.name);
    } catch (e) {
      if (e.code !== 'ERR_CANCELLED') toast(`Couldn't save: ${e.message}`);
    } finally {
      setSaving(null);
    }
  };

  // Back button closes the open sheet first.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (saving) return true;
      if (saveOpen) { setSaveOpen(false); return true; }
      return false;
    });
    return () => sub.remove();
  }, [saveOpen, saving]);

  let body;
  if (phase === 'loading') {
    body = (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.centerText}>Reading the song… {Math.round(progress * 100)}%</Text>
      </View>
    );
  } else if (phase === 'error') {
    body = (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={42} color={colors.danger} />
        <Text style={styles.centerText}>{error}</Text>
        <Pressable onPress={load} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable>
      </View>
    );
  } else {
    body = (
      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.card}>
          <Waveform
            peaks={peaks}
            durationMs={duration}
            startMs={start}
            endMs={end}
            onChange={setCut}
            onDragStart={stopPreview}
            playheadMs={preview?.positionMs}
          />
          <View style={styles.timeRow}>
            <Text style={styles.timeEdge}>0:00</Text>
            <Text style={styles.timeEdge}>{clock(duration)}</Text>
          </View>
          <View style={styles.nudges}>
            <Nudge label="Start" ms={start} onMinus={() => nudgeStart(-100)} onPlus={() => nudgeStart(100)} />
            <View style={styles.lengthBox}>
              <Text style={styles.nudgeLabel}>Length</Text>
              <Text style={styles.length}>{clock(end - start)}</Text>
            </View>
            <Nudge label="End" ms={end} onMinus={() => nudgeEnd(-100)} onPlus={() => nudgeEnd(100)} />
          </View>

          <View style={styles.playRow}>
            <Pressable onPress={markStart} disabled={!previewing} style={[styles.mark, !previewing && styles.off]}>
              <Ionicons name="flag-outline" size={16} color={colors.text} />
              <Text style={styles.markText}>Start here</Text>
            </Pressable>
            <Pressable onPress={togglePreview} style={styles.play} accessibilityLabel={previewing ? 'Stop' : 'Play the cut'}>
              <Ionicons name={previewing ? 'stop' : 'play'} size={30} color={colors.bg} style={!previewing && { marginLeft: 3 }} />
            </Pressable>
            <Pressable onPress={markEnd} disabled={!previewing} style={[styles.mark, !previewing && styles.off]}>
              <Ionicons name="flag" size={16} color={colors.text} />
              <Text style={styles.markText}>End here</Text>
            </Pressable>
          </View>
          <Text style={styles.hint}>Drag the white handles, or drag the green part to move it. While it plays, tap Start here / End here.</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Length</Text>
          <Chips
            options={[...LENGTHS.filter((l) => l < duration), duration]}
            value={end - start}
            label={(l) => (l === duration ? 'Whole song' : `${l / 1000} s`)}
            onChange={(l) => (l === duration ? setCut(0, duration) : setLength(l))}
          />
          <Text style={styles.sub}>Ringtones usually play 20–30 s; SMS sounds 3–5 s.</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Sound</Text>
            {!!changed && <Pressable onPress={reset} hitSlop={8}><Text style={styles.reset}>Reset</Text></Pressable>}
          </View>
          <Text style={styles.label}>Fade in</Text>
          <Chips options={FADES} value={fadeIn} label={(f) => (f ? `${f / 1000} s` : 'Off')} onChange={setFadeIn} />
          <Text style={styles.label}>Fade out</Text>
          <Chips options={FADES} value={fadeOut} label={(f) => (f ? `${f / 1000} s` : 'Off')} onChange={setFadeOut} />
          <View style={styles.sliderHead}>
            <Text style={styles.label}>Volume</Text>
            <Text style={styles.value}>{db(gainDb)}</Text>
          </View>
          <Slider value={gainDb} min={-10} max={10} step={1} center onChange={setGainDb} />
        </View>

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.cardTitle}>Equalizer</Text>
            <Text style={styles.value}>{preset}</Text>
          </View>
          <Chips options={PRESETS.map((p) => p.name)} value={preset} label={(n) => n}
            onChange={(n) => setEq(PRESETS.find((p) => p.name === n).eq)} />
          {EQ_BANDS.map((band, i) => (
            <View key={band}>
              <View style={styles.sliderHead}>
                <Text style={styles.label}>{band}{i === 0 ? '  · bass' : i === EQ_BANDS.length - 1 ? '  · treble' : ''}</Text>
                <Text style={styles.value}>{db(eq[i])}</Text>
              </View>
              <Slider value={eq[i]} min={-12} max={12} step={1} center
                onChange={(v) => setEq((cur) => cur.map((x, j) => (j === i ? v : x)))} />
            </View>
          ))}
          <Text style={styles.sub}>Press play to hear changes as you make them.</Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} accessibilityLabel="Close">
          <Ionicons name="chevron-down" size={28} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={styles.h1}>{source.title || 'Edit sound'}</Text>
          {!!source.artist && <Text numberOfLines={1} style={styles.artist}>{source.artist}</Text>}
        </View>
        <Pressable
          onPress={() => { stopPreview(); setSaveOpen(true); }}
          disabled={phase !== 'ready'}
          style={[styles.saveBtn, phase !== 'ready' && styles.off]}
        >
          <Text style={styles.saveText}>Save</Text>
        </Pressable>
      </View>
      {body}

      <Sheet visible={saveOpen} onClose={() => !saving && setSaveOpen(false)}>
        <Text style={styles.sheetTitle}>Save {clock(end - start)} of sound</Text>
        <TextInput
          value={name}
          onChangeText={setName}
          style={styles.input}
          placeholder="Name"
          placeholderTextColor={colors.textDim}
          maxLength={80}
          editable={!saving}
        />
        {SAVE_AS.map((o) => (
          <SheetItem
            key={o.kind}
            icon={o.icon}
            label={saving === o.kind ? `Saving… ${Math.round(progress * 100)}%` : o.set}
            color={saving && saving !== o.kind ? colors.textDim : colors.text}
            onPress={saving ? undefined : () => doSave(o.kind)}
            right={saving === o.kind ? <ActivityIndicator color={colors.accent} /> : null}
          />
        ))}
        <Text style={styles.sheetNote}>{SAVE_NOTE}</Text>
      </Sheet>

      <Sheet visible={!!saved} onClose={() => setSaved(null)}>
        {!!saved && (
          <>
            <View style={styles.doneHead}>
              <Ionicons name="checkmark-circle" size={36} color={colors.accent} />
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetTitle}>Saved “{saved.name}”</Text>
                <Text style={styles.sub}>{saved.folder} · {clock(saved.durationMs)}</Text>
              </View>
            </View>
            {Object.entries(SOUND_KINDS).filter(([k]) => k !== saved.kind).map(([k, o]) => (
              <SheetItem key={k} icon={o.icon} label={o.set} onPress={() => setPhoneSound(saved.uri, k, null, saved.name)} />
            ))}
            <SheetItem icon="folder-open-outline" label="See all my ringtones & edits"
              onPress={() => { setSaved(null); navigation.navigate('Tabs', { screen: 'Library', params: { screen: 'Edits' } }); }} />
            <SheetItem icon="create-outline" label="Keep editing" onPress={() => setSaved(null)} />
            <SheetItem icon="close" label="Done" onPress={() => { setSaved(null); navigation.goBack(); }} />
          </>
        )}
      </Sheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  h1: { color: colors.text, fontSize: 17, fontWeight: '800' },
  artist: { color: colors.textMuted, fontSize: 13 },
  saveBtn: { backgroundColor: colors.accent, borderRadius: 18, paddingHorizontal: 18, paddingVertical: 8 },
  saveText: { color: colors.bg, fontWeight: '800', fontSize: 14 },
  off: { opacity: 0.4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 32 },
  centerText: { color: colors.textMuted, fontSize: 15, textAlign: 'center' },
  retry: { borderRadius: 18, borderWidth: 1, borderColor: colors.textDim, paddingHorizontal: 18, paddingVertical: 8 },
  retryText: { color: colors.text, fontWeight: '700' },
  body: { padding: 16, paddingBottom: 40, gap: 14 },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: 14 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { color: colors.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  reset: { color: colors.accent, fontWeight: '700', fontSize: 13 },
  timeRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  timeEdge: { color: colors.textDim, fontSize: 11 },
  nudges: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 10 },
  nudge: { alignItems: 'center' },
  nudgeLabel: { color: colors.textMuted, fontSize: 12, marginBottom: 4 },
  nudgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  nudgeBtn: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  nudgeTime: { color: colors.text, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'], minWidth: 52, textAlign: 'center' },
  lengthBox: { alignItems: 'center' },
  length: { color: colors.accent, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'], paddingBottom: 4 },
  playRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 },
  play: { width: 60, height: 60, borderRadius: 30, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  mark: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.textDim, paddingHorizontal: 12, paddingVertical: 7, width: 112, justifyContent: 'center' },
  markText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  hint: { color: colors.textDim, fontSize: 12, marginTop: 12, textAlign: 'center', lineHeight: 17 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { borderRadius: 16, borderWidth: 1, borderColor: colors.textDim, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  label: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 14 },
  sliderHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  value: { color: colors.textMuted, fontSize: 13, fontVariant: ['tabular-nums'] },
  sub: { color: colors.textMuted, fontSize: 12, marginTop: 10, lineHeight: 17 },
  sheetTitle: { color: colors.text, fontSize: 16, fontWeight: '800', paddingHorizontal: 20 },
  input: { marginHorizontal: 20, marginVertical: 12, backgroundColor: colors.surfaceHigh, color: colors.text, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  sheetNote: { color: colors.textDim, fontSize: 12, paddingHorizontal: 20, paddingTop: 6, lineHeight: 17 },
  doneHead: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 16, paddingBottom: 8 },
});
