// Browser version of the audio editor (the phone uses the native module, android/…/audioeditor).
// Same functions and events, so the editor screens work unchanged:
//   analyze, cancel, startPreview / updatePreview / stopPreview, exportEdit, listEdits, deleteEdit.
// The sound processing is a straight port of Dsp.kt (equalizer, volume, fades, soft limiter), so an
// edit sounds the same on both. Edits are WAV files kept in this browser (IndexedDB); a browser
// can't set a phone's ringtone, so those choices download the file instead (src/utils/phoneSounds.web.js).
import { fileFor } from '../../src/utils/localFiles';

const AudioCtx = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;
export const EDITOR_SUPPORTED = !!AudioCtx && typeof indexedDB !== 'undefined';
export const EQ_BANDS = ['60 Hz', '230 Hz', '910 Hz', '3.6 kHz', '14 kHz'];
// Video editing is in the phone app only (it copies the video stream on the phone).
export const VIDEO_TOOLS_SUPPORTED = false;
const EQ_FREQS = [60, 230, 910, 3600, 14000];

// ---- events ----
const listeners = { onProgress: new Set(), onPreviewProgress: new Set(), onPreviewEnd: new Set() };
const emit = (name, body) => listeners[name]?.forEach((fn) => { try { fn(body); } catch (e) { /* listener error */ } });
function addListener(name, fn) {
  listeners[name]?.add(fn);
  return { remove: () => listeners[name]?.delete(fn) };
}

const coded = (code, message) => Object.assign(new Error(message), { code });

// ---- reading songs ----
let ctx = null;
const audioCtx = () => ctx || (ctx = new AudioCtx());
let generation = 0;
let decoded = { uri: null, buffer: null };

async function readBytes(uri, isCancelled) {
  const file = fileFor(uri);
  if (file) { emit('onProgress', { progress: 0.4 }); return file.arrayBuffer(); }
  const res = await fetch(uri, { cache: 'no-store' });
  if (!res.ok) throw coded('ERR_ANALYZE', `Couldn't load the song (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body || !total) return res.arrayBuffer();
  const reader = res.body.getReader();
  const parts = [];
  let got = 0;
  for (;;) {
    if (isCancelled()) { reader.cancel().catch(() => {}); throw coded('ERR_CANCELLED', 'Cancelled'); }
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    emit('onProgress', { progress: Math.min(0.8, (got / total) * 0.8) });
  }
  const out = new Uint8Array(got);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out.buffer;
}

async function decode(uri, isCancelled) {
  if (decoded.uri === uri && decoded.buffer) return decoded.buffer;
  const bytes = await readBytes(uri, isCancelled);
  if (isCancelled()) throw coded('ERR_CANCELLED', 'Cancelled');
  let buffer;
  try {
    buffer = await audioCtx().decodeAudioData(bytes);
  } catch (e) {
    throw coded('ERR_ANALYZE', 'This browser can\'t read this kind of audio file');
  }
  decoded = { uri, buffer };
  return buffer;
}

async function analyze(uri) {
  const gen = generation;
  const isCancelled = () => gen !== generation;
  emit('onProgress', { progress: 0 });
  const buffer = await decode(uri, isCancelled);
  if (isCancelled()) throw coded('ERR_CANCELLED', 'Cancelled');
  const rate = buffer.sampleRate;
  const perBucket = Math.max(1, Math.floor(rate / 10));
  const chans = Array.from({ length: Math.min(2, buffer.numberOfChannels) }, (_, c) => buffer.getChannelData(c));
  const peaks = [];
  for (let start = 0; start < buffer.length; start += perBucket) {
    const end = Math.min(buffer.length, start + perBucket);
    let peak = 0;
    for (const data of chans) for (let i = start; i < end; i++) { const v = Math.abs(data[i]); if (v > peak) peak = v; }
    peaks.push(peak);
  }
  emit('onProgress', { progress: 1 });
  return { durationMs: (buffer.length * 1000) / rate, peaks, sampleRate: rate, channels: chans.length };
}

// Called when the editor closes: stop any loading and free the decoded song (it can be ~100 MB).
function cancel() {
  generation += 1;
  decoded = { uri: null, buffer: null };
}

// ---- the sound processing (same as Dsp.kt) ----
function bandCoeffs(band, gainDb, fs) {
  const f = Math.min(EQ_FREQS[band], fs * 0.45);
  const a = 10 ** (gainDb / 40);
  const w0 = (2 * Math.PI * f) / fs;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  let b0; let b1; let b2; let a0; let a1; let a2;
  if (band === 0 || band === EQ_FREQS.length - 1) {
    const k = 2 * Math.sqrt(a) * ((sw / 2) * Math.sqrt(2));
    if (band === 0) { // low shelf
      b0 = a * ((a + 1) - (a - 1) * cw + k); b1 = 2 * a * ((a - 1) - (a + 1) * cw); b2 = a * ((a + 1) - (a - 1) * cw - k);
      a0 = (a + 1) + (a - 1) * cw + k; a1 = -2 * ((a - 1) + (a + 1) * cw); a2 = (a + 1) + (a - 1) * cw - k;
    } else { // high shelf
      b0 = a * ((a + 1) + (a - 1) * cw + k); b1 = -2 * a * ((a - 1) + (a + 1) * cw); b2 = a * ((a + 1) + (a - 1) * cw - k);
      a0 = (a + 1) - (a - 1) * cw + k; a1 = 2 * ((a - 1) - (a + 1) * cw); a2 = (a + 1) - (a - 1) * cw - k;
    }
  } else { // peaking, Q 1
    const alpha = sw / 2;
    b0 = 1 + alpha * a; b1 = -2 * cw; b2 = 1 - alpha * a; a0 = 1 + alpha / a; a1 = -2 * cw; a2 = 1 - alpha / a;
  }
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}

const curve = (t) => (1 - Math.cos(Math.PI * Math.min(Math.max(t, 0), 1))) / 2;
function limit(x) {
  const knee = 0.89;
  const ax = Math.abs(x);
  if (ax <= knee) return x;
  const y = knee + (1 - knee) * Math.tanh((ax - knee) / (1 - knee));
  return x < 0 ? -y : y;
}

const normalize = (p = {}) => ({
  gainDb: Math.min(20, Math.max(-20, Number(p.gainDb) || 0)),
  eq: EQ_FREQS.map((_, i) => Math.min(15, Math.max(-15, Number(p.eq?.[i]) || 0))),
  fadeInMs: Math.max(0, Number(p.fadeInMs) || 0),
  fadeOutMs: Math.max(0, Number(p.fadeOutMs) || 0),
});

/**
 * The cut [startMs, endMs] of `buffer` with the edit applied, from `fromFrame` (frames into the cut)
 * to its end: one Float32Array per channel (1 or 2).
 */
function render(buffer, startMs, endMs, params, fromFrame = 0) {
  const p = normalize(params);
  const fs = buffer.sampleRate;
  const first = Math.max(0, Math.round((startMs / 1000) * fs));
  const last = Math.min(buffer.length, Math.round((endMs / 1000) * fs));
  const total = Math.max(0, last - first);
  const nCh = Math.min(2, buffer.numberOfChannels);
  const coeffs = p.eq.map((g, b) => (Math.abs(g) < 0.05 ? null : bandCoeffs(b, g, fs)));
  const gain = 10 ** (p.gainDb / 20);
  const fadeIn = Math.round((p.fadeInMs * fs) / 1000);
  const fadeOut = Math.round((p.fadeOutMs * fs) / 1000);
  const out = [];
  for (let c = 0; c < nCh; c++) {
    const src = buffer.getChannelData(c);
    const dst = new Float32Array(Math.max(0, total - fromFrame));
    const state = coeffs.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < dst.length; i++) {
      const pos = fromFrame + i;
      let env = gain;
      if (fadeIn > 0 && pos < fadeIn) env *= curve(pos / fadeIn);
      const left = total - pos;
      if (fadeOut > 0 && left < fadeOut) env *= curve(Math.max(0, left) / fadeOut);
      let x = src[first + pos];
      for (let b = 0; b < coeffs.length; b++) {
        const k = coeffs[b];
        if (!k) continue;
        const s = state[b];
        const y = k[0] * x + k[1] * s[0] + k[2] * s[1] - k[3] * s[2] - k[4] * s[3];
        s[1] = s[0]; s[0] = x; s[3] = s[2]; s[2] = y;
        x = y;
      }
      dst[i] = limit(x * env);
    }
    out.push(dst);
  }
  return out;
}

// ---- preview ----
let preview = null; // { uri, startMs, endMs, params, source, startedAt, offsetFrames, timer, rate }

function stopSource(p) {
  if (!p) return;
  clearInterval(p.timer);
  if (p.source) { p.source.onended = null; try { p.source.stop(); } catch (e) { /* not started */ } p.source.disconnect(); }
}

function playFrom(p, fromFrame) {
  const c = audioCtx();
  const chans = render(decoded.buffer, p.startMs, p.endMs, p.params, fromFrame);
  if (!chans[0]?.length) { finishPreview(p, null); return; }
  const buf = c.createBuffer(chans.length, chans[0].length, p.rate);
  chans.forEach((d, i) => buf.copyToChannel(d, i));
  const src = c.createBufferSource();
  src.buffer = buf;
  src.connect(c.destination);
  src.onended = () => finishPreview(p, null);
  p.source = src;
  p.offsetFrames = fromFrame;
  p.startedAt = c.currentTime;
  src.start();
}

const positionMs = (p) => p.startMs + (p.offsetFrames / p.rate) * 1000 + (audioCtx().currentTime - p.startedAt) * 1000;

function finishPreview(p, error) {
  if (preview !== p) return;
  stopSource(p);
  preview = null;
  emit('onPreviewEnd', { error });
}

function startPreview(uri, startMs, endMs, params) {
  stopPreview();
  if (decoded.uri !== uri || !decoded.buffer) { emit('onPreviewEnd', { error: 'Load the song first' }); return; }
  const c = audioCtx();
  if (c.state === 'suspended') c.resume().catch(() => {});
  const p = { uri, startMs, endMs, params, rate: decoded.buffer.sampleRate, source: null, offsetFrames: 0, startedAt: 0, timer: 0, pending: 0 };
  preview = p;
  try { playFrom(p, 0); } catch (e) { finishPreview(p, e.message); return; }
  p.timer = setInterval(() => { if (preview === p) emit('onPreviewProgress', { positionMs: positionMs(p) }); }, 100);
}

// Changes are heard straight away: the rest of the cut is processed again from where it's playing.
function updatePreview(params) {
  const p = preview;
  if (!p) return;
  p.params = params;
  clearTimeout(p.pending);
  p.pending = setTimeout(() => {
    if (preview !== p) return;
    const from = Math.max(0, Math.round(((positionMs(p) - p.startMs) / 1000) * p.rate));
    if (p.source) { p.source.onended = null; try { p.source.stop(); } catch (e) { /* ended */ } p.source.disconnect(); }
    try { playFrom(p, from); } catch (e) { finishPreview(p, e.message); }
  }, 120);
}

function stopPreview() {
  const p = preview;
  preview = null;
  if (p) { clearTimeout(p.pending); stopSource(p); }
}

// ---- saving: WAV files in IndexedDB ----
function wav(chans, rate) {
  const n = chans[0].length;
  const ch = chans.length;
  const view = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, ch, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * ch * 2, true); view.setUint16(32, ch * 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, n * ch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(o, Math.round(v * 32767), true);
      o += 2;
    }
  }
  return new Blob([view.buffer], { type: 'audio/wav' });
}

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('viberoom-edits', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('edits', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function store(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('edits', mode);
    const req = fn(tx.objectStore('edits'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

const urls = new Map(); // edit id -> blob: url (made once per visit)
const urlFor = (e) => { if (!urls.has(e.id)) urls.set(e.id, URL.createObjectURL(e.blob)); return urls.get(e.id); };
const FOLDER = 'Saved in this browser';
const safeName = (s) => String(s || '').replace(/[\\/:*?"<>|\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'VibeRoom edit';

async function exportEdit(uri, options = {}) {
  const startMs = Number(options.startMs) || 0;
  const endMs = Number(options.endMs) || 0;
  if (endMs - startMs < 500) throw coded('ERR_EXPORT', 'The cut is too short');
  const gen = generation;
  stopPreview();
  emit('onProgress', { progress: 0.05 });
  const buffer = await decode(uri, () => gen !== generation);
  emit('onProgress', { progress: 0.3 });
  await new Promise((r) => setTimeout(r, 0)); // let the progress show
  const chans = render(buffer, startMs, endMs, options);
  if (!chans[0]?.length) throw coded('ERR_EXPORT', 'Nothing to save in that part of the song');
  emit('onProgress', { progress: 0.8 });
  const blob = wav(chans, buffer.sampleRate);
  const kind = ['ringtone', 'alarm', 'notification'].includes(options.kind) ? options.kind : 'music';
  const entry = {
    id: `${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    name: safeName(options.name),
    kind,
    durationMs: (chans[0].length * 1000) / buffer.sampleRate,
    size: blob.size,
    addedAt: Date.now(),
    blob,
  };
  try { await navigator.storage?.persist?.(); } catch (e) { /* ignore */ }
  await store('readwrite', (s) => s.put(entry));
  emit('onProgress', { progress: 1 });
  return { uri: urlFor(entry), name: entry.name, kind, durationMs: entry.durationMs, folder: FOLDER };
}

async function listEdits() {
  const all = (await store('readonly', (s) => s.getAll())) || [];
  return all.sort((a, b) => b.addedAt - a.addedAt).map((e) => ({
    id: e.id, uri: urlFor(e), name: e.name, durationMs: e.durationMs, size: e.size, addedAt: e.addedAt,
    kind: e.kind, folder: FOLDER, isRingtone: false, isAlarm: false, isNotification: false,
  }));
}

async function deleteEdit(uri) {
  const id = [...urls.entries()].find(([, u]) => u === uri)?.[0];
  if (!id) return;
  await store('readwrite', (s) => s.delete(id));
  try { URL.revokeObjectURL(uri); } catch (e) { /* gone */ }
  urls.delete(id);
}

const AudioEditor = EDITOR_SUPPORTED ? {
  addListener, analyze, cancel, startPreview, updatePreview, stopPreview, exportEdit, listEdits, deleteEdit,
  canWriteSettings: () => false,
  openWriteSettings: () => {},
  setAsDefault: async () => { throw coded('ERR_UNSUPPORTED', 'A browser can\'t change your phone\'s sounds'); },
} : null;

export default AudioEditor;
