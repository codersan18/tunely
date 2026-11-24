// Browser version of videoSource.js: the videos in a folder the person picks on their computer.
// Chrome / Edge remember the folder (asking again for permission on a new visit); other browsers
// pick the folder each visit. Nothing is uploaded: the files play straight from the computer.

const canRememberFolder = typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
export const VIDEOS_SUPPORTED = typeof document !== 'undefined';
export const PLACE = {
  intro: 'Watch the videos on this computer. Pick the folder they\'re in; they play from your computer and nothing is uploaded.',
  denied: 'VibeRoom can\'t read that folder. Pick it again.',
  allow: 'Choose a video folder',
  canChangeFolder: true,
};

const VIDEO = /\.(mp4|m4v|mov|webm|mkv|ogv|3gp)$/i;
const MAX_FILES = 3000;

// The chosen folder survives a reload (IndexedDB can store folder handles).
function kv(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('viberoom-videos', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('kv');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      try {
        const tx = open.result.transaction('kv', mode);
        const req = fn(tx.objectStore('kv'));
        tx.oncomplete = () => resolve(req?.result);
        tx.onerror = () => reject(tx.error);
      } catch (e) {
        reject(e); // e.g. a folder this browser can't store: it's just not remembered
      }
    };
  });
}
const loadHandle = () => kv('readonly', (s) => s.get('folder')).catch(() => null);
const saveHandle = (h) => kv('readwrite', (s) => s.put(h, 'folder')).catch(() => {});

let handle = null;
let picked = null;
const links = new Map(); // path -> blob: link (kept while the file is listed)

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
    input.onchange = () => { picked = [...(input.files || [])]; resolve(picked.length ? 'granted' : 'needs-permission'); };
    input.oncancel = () => resolve(picked ? 'granted' : 'needs-permission');
    input.click();
  });
}

async function pickFolder() {
  try {
    handle = await window.showDirectoryPicker({ id: 'viberoom-videos', mode: 'read' });
    await saveHandle(handle);
    return 'granted';
  } catch (e) {
    return handle ? 'granted' : 'needs-permission';
  }
}

// From a tap or click only (browsers show their dialogs then).
export async function requestAccess() {
  if (!canRememberFolder) return pickWithInput();
  if (handle) {
    try { if ((await handle.requestPermission({ mode: 'read' })) === 'granted') return 'granted'; } catch (e) { /* pick again */ }
  }
  return pickFolder();
}

export function changeFolder() {
  return canRememberFolder ? pickFolder() : pickWithInput();
}

async function walk(dir, prefix, out, depth) {
  for await (const entry of dir.values()) {
    if (out.length >= MAX_FILES) return;
    if (entry.kind === 'directory') {
      if (depth < 8 && !entry.name.startsWith('.')) await walk(entry, `${prefix}${entry.name}/`, out, depth + 1);
    } else if (VIDEO.test(entry.name)) {
      try { out.push({ file: await entry.getFile(), path: `${prefix}${entry.name}` }); } catch (e) { /* unreadable */ }
    }
  }
}

function linkFor(path, file) {
  const old = links.get(path);
  if (old && old.size === file.size && old.modified === file.lastModified) return old.url;
  if (old) URL.revokeObjectURL(old.url);
  const url = URL.createObjectURL(file);
  links.set(path, { url, size: file.size, modified: file.lastModified });
  return url;
}

/** The videos: [{ id, uri, filename, folder, duration (s, 0 = unknown), modified }], newest first. */
export async function listVideos() {
  let found = [];
  if (picked) found = picked.filter((f) => VIDEO.test(f.name)).map((f) => ({ file: f, path: f.webkitRelativePath || f.name }));
  else if (handle) await walk(handle, `${handle.name}/`, found, 0);
  found.sort((a, b) => b.file.lastModified - a.file.lastModified);
  return found.map(({ file, path }) => {
    const parts = path.split('/');
    return {
      id: path,
      uri: linkFor(path, file),
      filename: file.name,
      folder: parts.length > 1 ? parts[parts.length - 2] : 'Videos',
      duration: 0,
      modified: file.lastModified,
      width: 0,
      height: 0,
      size: file.size,
    };
  });
}

// A frame a little way in, drawn by the browser; cached for the visit.
const thumbs = new Map();
export function thumbnailFor(video) {
  if (thumbs.has(video.uri)) return thumbs.get(video.uri);
  const job = new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.preload = 'metadata';
    v.src = video.uri;
    const done = (r) => { v.removeAttribute('src'); v.load(); resolve(r); };
    v.onloadedmetadata = () => { v.currentTime = Math.min(3, (v.duration || 10) / 10); };
    v.onseeked = () => {
      try {
        const scale = Math.min(1, 320 / Math.max(v.videoWidth, v.videoHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        done(c.toDataURL('image/jpeg', 0.7));
      } catch (e) { done(null); }
    };
    v.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
  });
  thumbs.set(video.uri, job);
  return job;
}
