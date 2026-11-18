// Browser version of playerExtras.js.
//
// Equalizer: each song plays in an <audio> element (expo-audio's web player makes one per song).
// Once the equalizer is first switched on, every song's element is routed through five Web Audio
// filters with the same bands as the phone (60 Hz low shelf, 230 / 910 / 3600 Hz peaks, 14 kHz high
// shelf). Songs must be loaded with CORS for that, hence crossOrigin: 'anonymous' (the song storage
// allows any site; downloads play from blob: links).
//
// Data saver: on mobile data, the next song isn't loaded ahead of time.

const EQ_FREQS = [60, 230, 910, 3600, 14000];
const AudioCtx = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : null;

export const EQ_AVAILABLE = !!AudioCtx;
export const DATA_SAVER_AVAILABLE = true;
export const PLAYLIST_OPTIONS = { updateInterval: 500, crossOrigin: 'anonymous' };

let ctx = null;
let filters = [];
const routed = new WeakSet(); // <audio> elements already going through the filters
let eq = { on: false, bands: [0, 0, 0, 0, 0] };
let saver = false;

function graph() {
  if (ctx) return;
  ctx = new AudioCtx();
  filters = EQ_FREQS.map((f, i) => {
    const b = ctx.createBiquadFilter();
    b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
    b.frequency.value = f;
    if (b.type === 'peaking') b.Q.value = 1;
    return b;
  });
  filters.reduce((a, b) => { a.connect(b); return b; });
  filters[filters.length - 1].connect(ctx.destination);
}

function setGains() {
  filters.forEach((f, i) => { f.gain.value = eq.on ? (eq.bands?.[i] || 0) : 0; });
}

function route(media) {
  if (!ctx || !media || routed.has(media)) return;
  try {
    ctx.createMediaElementSource(media).connect(filters[0]);
    routed.add(media);
  } catch (e) { /* already routed, or the browser refused */ }
}

function sync(playlist, playing) {
  if (ctx) {
    route(playlist?._currentMedia);
    route(playlist?._nextMedia);
    if (playing && ctx.state === 'suspended') ctx.resume().catch(() => {});
  }
  const next = playlist?._nextMedia;
  if (next) {
    const want = saver ? 'none' : 'auto';
    if (next.preload !== want) next.preload = want;
  }
}

export function applyEq(playlist, on, bands) {
  eq = { on: !!on, bands: bands || [] };
  if (!AudioCtx) return { supported: false, active: false };
  if (!on && !ctx) return { supported: true, active: false }; // never switched on: leave playback alone
  try {
    graph();
    setGains();
    sync(playlist, false);
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return { supported: true, active: eq.on };
  } catch (e) {
    return { supported: false, active: false };
  }
}

function mobileData() {
  const c = typeof navigator !== 'undefined' ? navigator.connection : null;
  return !!c && (c.type === 'cellular' || c.saveData === true);
}

export function applyDataSaver(playlist, on, onMobileData) {
  saver = !!on && (onMobileData || mobileData());
  sync(playlist, false);
}

export function onPlayerStatus(playlist, playing) {
  sync(playlist, playing);
}
