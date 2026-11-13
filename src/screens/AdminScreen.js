import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ScrollView, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as SecureStore from 'expo-secure-store';
import { File } from 'expo-file-system';
import { colors } from '../theme';
import { useCatalog } from '../context/CatalogContext';
import { verifyAdmin, uploadSong, deleteSong, updateSong, getStorage } from '../api/catalog';
import Cover from '../components/Cover';
import ChipPicker from '../components/ChipPicker';
import { LANGUAGES, MOODS } from '../utils/smartShuffle';
import { readTags } from '../utils/readTags';

const KEY_NAME = 'tunely.adminKey';

// Same rule as the server: ignore case and extra spaces.
const norm = (s = '') => s.trim().replace(/\s+/g, ' ').toLowerCase();

// "Artist - Title.mp3" -> { artist, title }; otherwise the file name becomes the title.
function guessFromName(name = '') {
  const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const parts = base.split(/\s+-\s+/);
  if (parts.length >= 2) return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  return { artist: '', title: base };
}

let itemCounter = 0;

function Field({ label, value, onChangeText, placeholder, editable }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textDim}
        style={styles.input}
        editable={editable}
        autoCorrect={false}
      />
    </View>
  );
}

// ---------- Locked: ask for the admin password ----------

function Unlock({ onUnlocked }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    if (!key.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (await verifyAdmin(key.trim())) {
        await SecureStore.setItemAsync(KEY_NAME, key.trim());
        onUnlocked(key.trim());
      } else {
        setError('Wrong password.');
      }
    } catch (e) {
      setError("Couldn't reach the server. Check your internet connection.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.unlock}>
      <Ionicons name="lock-closed" size={40} color={colors.accent} />
      <Text style={styles.unlockTitle}>Manage songs</Text>
      <Text style={styles.unlockSub}>Only the library owner can add or remove songs. Enter the admin password.</Text>
      <TextInput
        value={key}
        onChangeText={setKey}
        placeholder="Admin password"
        placeholderTextColor={colors.textDim}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.input, { alignSelf: 'stretch' }]}
        onSubmitEditing={submit}
        returnKeyType="go"
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <Pressable onPress={submit} style={[styles.primary, (busy || !key.trim()) && { opacity: 0.5 }]} disabled={busy || !key.trim()}>
        {busy ? <ActivityIndicator color={colors.bg} /> : <Text style={styles.primaryText}>Unlock</Text>}
      </Pressable>
    </View>
  );
}

// ---------- Edit a song that's already in the library ----------

function SongEditor({ song, adminKey, onSaved, onCancel, onLocked }) {
  const [f, setF] = useState({
    title: song.title, artist: song.artist, album: song.album, genre: song.genre, language: song.language, mood: song.mood,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    if (!f.title.trim()) { setError('Title is required.'); return; }
    setBusy(true);
    setError(null);
    try {
      await updateSong(adminKey, song.songId, {
        title: f.title.trim(), artist: f.artist.trim(), album: f.album.trim(), genre: f.genre.trim(), language: f.language, mood: f.mood,
      });
      onSaved();
    } catch (e) {
      if (e.status === 401) onLocked();
      setError(e.message);
      setBusy(false);
    }
  };

  return (
    <View style={styles.editor}>
      <Field label="Title *" value={f.title} onChangeText={set('title')} editable={!busy} />
      <Field label="Artist" value={f.artist} onChangeText={set('artist')} placeholder="Unknown artist" editable={!busy} />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Field label="Album" value={f.album} onChangeText={set('album')} placeholder="Optional" editable={!busy} /></View>
        <View style={{ flex: 1 }}><Field label="Genre" value={f.genre} onChangeText={set('genre')} placeholder="Optional" editable={!busy} /></View>
      </View>
      <ChipPicker label="Language" options={LANGUAGES} value={f.language} onChange={set('language')} disabled={busy} />
      <ChipPicker label="Mood" options={MOODS} value={f.mood} onChange={set('mood')} disabled={busy} />
      {!!error && <Text style={styles.error}>{error}</Text>}
      <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
        <Pressable onPress={onCancel} disabled={busy} style={styles.secondary}><Text style={styles.secondaryText}>Cancel</Text></Pressable>
        <Pressable onPress={save} disabled={busy} style={[styles.primarySmall, busy && { opacity: 0.6 }]}>
          {busy ? <ActivityIndicator color={colors.bg} size="small" /> : <Text style={styles.primaryText}>Save</Text>}
        </Pressable>
      </View>
    </View>
  );
}

// ---------- Unlocked ----------

export default function AdminScreen({ navigation }) {
  const { songs, refresh } = useCatalog();
  const [adminKey, setAdminKey] = useState(undefined); // undefined = still checking
  const [items, setItems] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [tab, setTab] = useState('add'); // add | manage
  const [editing, setEditing] = useState(null); // song id being edited
  // New files start with the language/mood picked last time (uploads usually come in batches).
  const [lastTags, setLastTags] = useState({ language: '', mood: '' });
  const untagged = songs.filter((s) => !s.language || !s.mood).length;

  useEffect(() => {
    SecureStore.getItemAsync(KEY_NAME).then((k) => setAdminKey(k || null)).catch(() => setAdminKey(null));
  }, []);

  // How full song storage is. Uploads stop at 90%.
  const [storage, setStorage] = useState(null);
  const loadStorage = useCallback(() => {
    if (!adminKey) return;
    getStorage(adminKey).then(setStorage).catch(() => {});
  }, [adminKey]);
  useEffect(() => { loadStorage(); }, [loadStorage, songs.length]);
  const storageFull = !!storage?.full;

  const lock = async () => {
    await SecureStore.deleteItemAsync(KEY_NAME).catch(() => {});
    setAdminKey(null);
    setItems([]);
  };

  // Library lookups for the duplicate check.
  const byHash = useMemo(() => new Map(songs.filter((s) => s.hash).map((s) => [s.hash, s])), [songs]);
  const byName = useMemo(() => new Map(songs.map((s) => [`${norm(s.title)}|${norm(s.artist || 'Unknown artist')}`, s])), [songs]);

  // Why an item can't be uploaded (or null if it can).
  const duplicateOf = (item, all = items) => {
    const sameFile = byHash.get(item.hash);
    if (sameFile) return `This file is already in the library as "${sameFile.title}" by ${sameFile.artist}.`;
    const sameName = byName.get(`${norm(item.title)}|${norm(item.artist || 'Unknown artist')}`);
    if (sameName) return `"${sameName.title}" by ${sameName.artist} is already in the library.`;
    const earlier = all.find((o) => o.id !== item.id && o.status !== 'done'
      && all.indexOf(o) < all.indexOf(item)
      && (o.hash === item.hash || (norm(o.title) === norm(item.title) && norm(o.artist) === norm(item.artist))));
    if (earlier) return 'This song is picked twice. Only the first one will be added.';
    return null;
  };

  const update = (id, patch) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const remove = (id) => setItems((list) => list.filter((it) => it.id !== id));

  const pickSongs = async () => {
    const res = await DocumentPicker.getDocumentAsync({ type: 'audio/*', multiple: true, copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    setPreparing(true);
    try {
      const added = [];
      for (const a of res.assets) {
        let hash = null;
        try {
          hash = await new File(a.uri).digest('SHA-256');
        } catch (e) {
          continue; // unreadable file
        }
        const guess = guessFromName(a.name);
        // Details stored inside the file (title, artists, album, genre, cover) beat guessing from the name.
        let tags = null;
        try { tags = await readTags(a.uri); } catch (e) { /* not an MP3 or unreadable tags */ }
        added.push({
          id: `i${++itemCounter}`,
          uri: a.uri,
          name: a.name,
          mimeType: a.mimeType,
          size: a.size,
          hash,
          title: tags?.title || guess.title,
          artist: tags?.artist || guess.artist,
          album: tags?.album || '',
          genre: tags?.genre || '',
          language: tags?.language || lastTags.language,
          mood: tags?.mood || lastTags.mood,
          cover: tags?.cover || null,
          fromTags: !!tags,
          status: 'ready', // ready | working | done | duplicate | error
          message: null,
        });
      }
      setItems((list) => [...list, ...added]);
    } finally {
      setPreparing(false);
    }
  };

  const pickCover = async (id) => {
    const res = await DocumentPicker.getDocumentAsync({ type: ['image/jpeg', 'image/png', 'image/webp'], copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    update(id, { cover: { uri: a.uri, name: a.name, mimeType: a.mimeType } });
  };

  const pending = items.filter((it) => it.status !== 'done' && !duplicateOf(it) && it.title.trim());

  const uploadAll = async () => {
    setUploading(true);
    let added = 0;
    for (const it of pending) {
      update(it.id, { status: 'working', message: 'Checking' });
      try {
        await uploadSong(adminKey, {
          ...it,
          title: it.title.trim(),
          artist: it.artist.trim() || 'Unknown artist',
          album: it.album.trim(),
          genre: it.genre.trim(),
          language: it.language,
          mood: it.mood,
        }, (stage) => update(it.id, { message: stage }));
        update(it.id, { status: 'done', message: 'Added to the library' });
        added += 1;
      } catch (e) {
        if (e.status === 401) {
          update(it.id, { status: 'error', message: 'Admin password no longer valid.' });
          await lock();
          break;
        }
        update(it.id, { status: e.duplicate ? 'duplicate' : 'error', message: e.message });
      }
    }
    setUploading(false);
    if (added) refresh();
    loadStorage();
  };

  const confirmDelete = (song) => {
    Alert.alert('Remove song?', `"${song.title}" will be removed for everyone. People who downloaded it keep their copy.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteSong(adminKey, song.songId);
            refresh();
          } catch (e) {
            Alert.alert("Couldn't remove", e.message);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.top}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
          <Ionicons name="chevron-down" size={28} color={colors.text} />
        </Pressable>
        <Text style={styles.topTitle}>Manage songs</Text>
        {adminKey ? (
          <Pressable onPress={lock} hitSlop={10}>
            <Text style={styles.lockText}>Lock</Text>
          </Pressable>
        ) : <View style={{ width: 28 }} />}
      </View>

      {adminKey === undefined ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : !adminKey ? (
        <Unlock onUnlocked={setAdminKey} />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.tabs}>
            {[['add', 'Add songs'], ['manage', `Library (${songs.length})`]].map(([k, label]) => (
              <Pressable key={k} onPress={() => setTab(k)} style={[styles.chip, tab === k && styles.chipOn]}>
                <Text style={[styles.chipText, tab === k && { color: colors.bg }]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          {tab === 'add' ? (
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              {storage && (
                <View style={styles.storage}>
                  <View style={styles.storageRow}>
                    <Text style={styles.storageLabel}>Song storage</Text>
                    <Text style={[styles.storageLabel, storageFull && { color: colors.danger }]}>
                      {(storage.used / 1e9).toFixed(2)} of {(storage.limit / 1e9).toFixed(0)} GB · {storage.percent}%
                    </Text>
                  </View>
                  <View style={styles.storageBar}>
                    <View style={[styles.storageFill, {
                      width: `${Math.min(100, storage.percent)}%`,
                      backgroundColor: storageFull ? colors.danger : storage.percent >= 75 ? '#FFB547' : colors.accent,
                    }]} />
                    <View style={styles.storageMark} />
                  </View>
                  {storageFull && (
                    <Text style={styles.storageWarn}>
                      Storage is 90% full, so uploads are paused. Delete songs in the Library tab to make room.
                    </Text>
                  )}
                </View>
              )}
              <Pressable onPress={pickSongs} style={styles.pick} disabled={uploading || preparing}>
                {preparing ? <ActivityIndicator color={colors.accent} /> : <Ionicons name="add-circle-outline" size={26} color={colors.accent} />}
                <Text style={styles.pickText}>{preparing ? 'Reading files...' : 'Choose audio files'}</Text>
              </Pressable>
              <Text style={styles.hint}>
                Pick MP3, M4A, WAV, FLAC or OGG files. Title, artists, album, genre and cover are read from the
                file when it has them (otherwise from names like "Artist - Title.mp3"). Check them before uploading.
                Songs already in the library are skipped.
              </Text>

              {items.map((it) => {
                const dup = it.status === 'done' ? null : duplicateOf(it);
                const locked = uploading || it.status === 'done';
                const tone = it.status === 'done' ? colors.accent
                  : (dup || it.status === 'duplicate' || it.status === 'error') ? colors.danger : colors.textMuted;
                return (
                  <View key={it.id} style={[styles.card, (dup || it.status === 'duplicate') && styles.cardDup]}>
                    <View style={styles.cardHead}>
                      <Pressable onPress={() => !locked && pickCover(it.id)}>
                        <Cover uri={it.cover?.uri} seed={it.title} size={56} style={{ borderRadius: 4 }} />
                        {!locked && <Text style={styles.coverLabel}>{it.cover ? 'Change' : '+ Cover'}</Text>}
                      </Pressable>
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={styles.fileName}>{it.name}</Text>
                        <Text style={styles.fileSize}>
                          {it.size ? `${(it.size / (1024 * 1024)).toFixed(1)} MB` : ''}
                          {it.fromTags ? ' · details read from the file' : ''}
                        </Text>
                      </View>
                      {!uploading && it.status !== 'working' && (
                        <Pressable onPress={() => remove(it.id)} hitSlop={10}>
                          <Ionicons name="close" size={22} color={colors.textMuted} />
                        </Pressable>
                      )}
                    </View>

                    <Field label="Title *" value={it.title} onChangeText={(v) => update(it.id, { title: v, status: 'ready', message: null })} placeholder="Song title" editable={!locked} />
                    <Field label="Artist" value={it.artist} onChangeText={(v) => update(it.id, { artist: v, status: 'ready', message: null })} placeholder="Unknown artist" editable={!locked} />
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <View style={{ flex: 1 }}>
                        <Field label="Album" value={it.album} onChangeText={(v) => update(it.id, { album: v })} placeholder="Optional" editable={!locked} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Field label="Genre" value={it.genre} onChangeText={(v) => update(it.id, { genre: v })} placeholder="e.g. Melody" editable={!locked} />
                      </View>
                    </View>

                    <ChipPicker
                      label="Language (for smart shuffle)"
                      options={LANGUAGES}
                      value={it.language}
                      disabled={locked}
                      onChange={(v) => { update(it.id, { language: v }); setLastTags((t) => ({ ...t, language: v })); }}
                    />
                    <ChipPicker
                      label="Mood (for smart shuffle)"
                      options={MOODS}
                      value={it.mood}
                      disabled={locked}
                      onChange={(v) => { update(it.id, { mood: v }); setLastTags((t) => ({ ...t, mood: v })); }}
                    />

                    {(dup || it.message) && (
                      <View style={styles.statusRow}>
                        {it.status === 'working' && <ActivityIndicator size="small" color={colors.accent} />}
                        {it.status === 'done' && <Ionicons name="checkmark-circle" size={16} color={colors.accent} />}
                        {(dup || it.status === 'duplicate') && <Ionicons name="copy-outline" size={16} color={colors.danger} />}
                        <Text style={[styles.status, { color: tone }]}>{dup || it.message}</Text>
                      </View>
                    )}
                  </View>
                );
              })}

              {items.length > 0 && (
                <Pressable
                  onPress={uploadAll}
                  disabled={uploading || !pending.length || storageFull}
                  style={[styles.primary, { alignSelf: 'stretch', marginTop: 8 }, (uploading || !pending.length || storageFull) && { opacity: 0.5 }]}
                >
                  {uploading ? <ActivityIndicator color={colors.bg} /> : (
                    <Text style={styles.primaryText}>
                      {pending.length ? `Upload ${pending.length} ${pending.length === 1 ? 'song' : 'songs'}` : 'Nothing new to upload'}
                    </Text>
                  )}
                </Pressable>
              )}
              {items.some((it) => it.status === 'done') && !uploading && (
                <Pressable onPress={() => setItems((l) => l.filter((it) => it.status !== 'done'))} style={{ alignSelf: 'center', padding: 12 }}>
                  <Text style={styles.lockText}>Clear finished</Text>
                </Pressable>
              )}
            </ScrollView>
          ) : (
            <ScrollView contentContainerStyle={styles.body}>
              {!songs.length && <Text style={styles.hint}>No songs yet. Add some from the "Add songs" tab.</Text>}
              {untagged > 0 && (
                <Text style={styles.hint}>
                  {untagged} {untagged === 1 ? 'song needs' : 'songs need'} a language and mood for smart shuffle. Tap a song to edit it.
                </Text>
              )}
              {songs.map((s) => {
                const missing = [!s.language && 'language', !s.mood && 'mood'].filter(Boolean);
                return (
                  <View key={s.id}>
                    <Pressable onPress={() => setEditing(editing === s.id ? null : s.id)} style={styles.songRow}>
                      <Cover uri={s.artwork} seed={s.title} size={44} style={{ borderRadius: 4 }} />
                      <View style={{ flex: 1 }}>
                        <Text numberOfLines={1} style={styles.songTitle}>{s.title}</Text>
                        <Text numberOfLines={1} style={styles.songSub}>{[s.artist, s.language, s.mood].filter(Boolean).join(' · ')}</Text>
                        {missing.length > 0 && <Text style={styles.needsTags}>Needs {missing.join(' and ')}</Text>}
                      </View>
                      <Ionicons name={editing === s.id ? 'chevron-up' : 'create-outline'} size={20} color={colors.textMuted} />
                      <Pressable onPress={() => confirmDelete(s)} hitSlop={10}>
                        <Ionicons name="trash-outline" size={20} color={colors.danger} />
                      </Pressable>
                    </Pressable>
                    {editing === s.id && (
                      <SongEditor
                        song={s}
                        adminKey={adminKey}
                        onCancel={() => setEditing(null)}
                        onSaved={() => { setEditing(null); refresh(); }}
                        onLocked={lock}
                      />
                    )}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8 },
  topTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  lockText: { color: colors.accent, fontWeight: '700', fontSize: 14 },
  unlock: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 48, gap: 14 },
  unlockTitle: { color: colors.text, fontSize: 22, fontWeight: '800' },
  unlockSub: { color: colors.textMuted, fontSize: 14, textAlign: 'center', marginBottom: 8 },
  error: { color: colors.danger, fontSize: 13 },
  tabs: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
  chip: { borderRadius: 16, borderWidth: 1, borderColor: colors.textDim, paddingHorizontal: 14, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  body: { padding: 16, paddingBottom: 48, gap: 12 },
  pick: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 18, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.accent },
  pickText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  storage: { gap: 6 },
  storageRow: { flexDirection: 'row', justifyContent: 'space-between' },
  storageLabel: { color: colors.textMuted, fontSize: 12 },
  storageBar: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceHigh, overflow: 'hidden' },
  storageFill: { height: 6, borderRadius: 3 },
  storageMark: { position: 'absolute', left: '90%', top: 0, bottom: 0, width: 2, backgroundColor: colors.textDim }, // the 90% stop
  storageWarn: { color: colors.danger, fontSize: 12, lineHeight: 17 },
  hint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  card: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, gap: 8 },
  cardDup: { borderWidth: 1, borderColor: colors.danger },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  coverLabel: { color: colors.accent, fontSize: 11, textAlign: 'center', marginTop: 4 },
  fileName: { color: colors.text, fontSize: 13, fontWeight: '600' },
  fileSize: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  field: { gap: 4 },
  fieldLabel: { color: colors.textMuted, fontSize: 12 },
  input: { backgroundColor: colors.surfaceHigh, color: colors.text, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  status: { flex: 1, fontSize: 13 },
  primary: { backgroundColor: colors.accent, borderRadius: 24, paddingVertical: 14, paddingHorizontal: 32, alignItems: 'center', minWidth: 160 },
  primaryText: { color: colors.bg, fontWeight: '800', fontSize: 15 },
  songRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  needsTags: { color: '#FFB547', fontSize: 11, marginTop: 2 },
  editor: { backgroundColor: colors.surface, borderRadius: 10, padding: 12, gap: 10, marginTop: 8 },
  secondary: { borderRadius: 20, paddingVertical: 10, paddingHorizontal: 18, borderWidth: 1, borderColor: colors.textDim },
  secondaryText: { color: colors.text, fontWeight: '700' },
  primarySmall: { backgroundColor: colors.accent, borderRadius: 20, paddingVertical: 10, paddingHorizontal: 24, alignItems: 'center', minWidth: 90 },
  songTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  songSub: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
});
