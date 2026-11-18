// Browser version of localSource.js: "On this computer" plays the songs in a music folder the
// person picks. Chrome and Edge remember the folder (the browser asks again on the next visit with
// one click); other browsers ask for it each visit. Files are played and read in place: nothing is
// uploaded or copied.
import { keepOnly, linkFor } from './localFiles';

const canRememberFolder = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
export const LOCAL_SUPPORTED = typeof document !== 'undefined'
  && (canRememberFolder || 'webkitdirectory' in document.createElement('input'));

export const PLACE = {
  title: 'On this computer',
  where: 'on this computer',
  icon: 'laptop-outline',
  intro: 'Play the songs in a music folder on this computer, with their covers and details. They play from the folder; nothing is uploaded or copied.',
  denied: '',
  allow: 'Choose your music folder',
  canChangeFolder: true,
};

const AUDIO = /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|weba)$/i;
const MIN_BYTES = 300 * 1024; // smaller files are mostly sounds and voice notes
const MAX_FILES = 5000;

// The folder handle is kept in IndexedDB (the only place that can hold it).
function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('viberoom-local', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function kv(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}
const loadHandle = () => kv('readonly', (s) => s.get('music')).catch(() => null);
const saveHandle = (h) => kv('readwrite', (s) => s.put(h, 'music')).catch(() => {});

let handle = null;      // Chrome / Edge: the chosen folder
let picked = null;      // other browsers: the files chosen this visit

export async function checkAccess() {
  if (picked) return 'granted';
  if (!canRememberFolder) return 'needs-permission';
  handle = handle || (await loadHandle());
  if (!handle) return 'needs-permission';
  try {
    return (await handle.queryPermission({ mode: 'read' })) === 'granted' ? 'granted' : 'needs-permission';
  } catch (e) {
    return 'needs-permission';
  }
}

function pickWithInput() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.webkitdirectory = true;
    input.onchange = () => {
      picked = [...(input.files || [])];
      resolve(picked.length ? 'granted' : 'needs-permission');
    };
    input.oncancel = () => resolve(picked ? 'granted' : 'needs-permission');
    input.click();
  });
}

async function pickFolder() {
  try {
    handle = await window.showDirectoryPicker({ id: 'viberoom-music', mode: 'read' });
    await saveHandle(handle);
    return 'granted';
  } catch (e) {
    return handle ? 'granted' : 'needs-permission'; // cancelled
  }
}

// Must run from a tap or click (the browser only shows its dialogs then).
export async function requestAccess() {
  if (!canRememberFolder) return pickWithInput();
  if (handle) {
    try {
      if ((await handle.requestPermission({ mode: 'read' })) === 'granted') return 'granted';
    } catch (e) { /* ask for a folder instead */ }
  }
  return pickFolder();
}

/** Pick a different music folder. */
export function changeFolder() {
  return canRememberFolder ? pickFolder() : pickWithInput();
}

async function walk(dir, prefix, out, depth) {
  for await (const entry of dir.values()) {
    if (out.length >= MAX_FILES) return;
    if (entry.kind === 'directory') {
      if (depth < 8 && !entry.name.startsWith('.')) await walk(entry, `${prefix}${entry.name}/`, out, depth + 1);
    } else if (AUDIO.test(entry.name)) {
      try { out.push({ file: await entry.getFile(), path: `${prefix}${entry.name}` }); } catch (e) { /* unreadable */ }
    }
  }
}

/** The audio files: [{ id, uri, path, filename, duration (s, 0 = unknown), modified }], newest first. */
export async function listFiles() {
  let found = [];
  if (picked) found = picked.filter((f) => AUDIO.test(f.name)).map((f) => ({ file: f, path: f.webkitRelativePath || f.name }));
  else if (handle) await walk(handle, `${handle.name}/`, found, 0);
  found = found.filter((f) => f.file.size >= MIN_BYTES).sort((a, b) => b.file.lastModified - a.file.lastModified);
  keepOnly(found.map((f) => f.path)); // release links of files that are gone
  return found.map(({ file, path }) => ({
    id: path,
    uri: linkFor(path, file),
    path: `/${path}`,
    filename: file.name,
    duration: 0,
    modified: file.lastModified,
  }));
}
