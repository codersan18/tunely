// Covers of songs saved on the phone ("On this phone"). The song's artwork is the marker
// `localcover:<file uri>`; the cover is read from the MP3's tag when it's shown and kept in memory
// only (nothing is written to the phone). The last few are remembered so scrolling back is instant.

import { useEffect, useState } from 'react';
import { Directory, File, Paths } from 'expo-file-system';
import { readCover, readCoverDataUri } from './readTags';

export const LOCAL_COVER = 'localcover:';
export const localCover = (fileUri) => `${LOCAL_COVER}${fileUri}`;
export const isLocalCover = (artwork) => typeof artwork === 'string' && artwork.startsWith(LOCAL_COVER);

const KEEP = 100;
const cache = new Map();   // file uri -> data: uri, or null (no cover); most recently used last
const loading = new Map(); // file uri -> promise

function remember(key, value) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > KEEP) cache.delete(cache.keys().next().value);
}

function loadCover(fileUri) {
  if (cache.has(fileUri)) {
    const value = cache.get(fileUri);
    remember(fileUri, value);
    return Promise.resolve(value);
  }
  if (!loading.has(fileUri)) {
    loading.set(fileUri, readCoverDataUri(fileUri)
      .catch(() => null)
      .then((value) => { remember(fileUri, value); loading.delete(fileUri); return value; }));
  }
  return loading.get(fileUri);
}

// The lock screen can only show a cover from a web link or a file. For the song that's playing,
// write its cover to one small file in the cache (the previous one is deleted), and return its uri.
let lockFile = null;
let lockKey = 0;
let cleaned = false;
export async function lockScreenCover(artwork) {
  if (!isLocalCover(artwork)) return null;
  const key = ++lockKey;
  if (!cleaned) { // covers left behind if the app was closed mid-song
    cleaned = true;
    try {
      new Directory(Paths.cache).list()
        .filter((f) => f instanceof File && f.name?.startsWith('lockscreen-cover-'))
        .forEach((f) => f.delete());
    } catch (e) { /* nothing to clean */ }
  }
  try {
    const pic = await readCover(artwork.slice(LOCAL_COVER.length));
    if (key !== lockKey) return null; // another song started meanwhile
    try { if (lockFile?.exists) lockFile.delete(); } catch (e) { /* already gone */ }
    lockFile = null;
    if (!pic) return null;
    // A new name each time: the lock screen skips loading a link it has already shown.
    const file = new File(Paths.cache, `lockscreen-cover-${Date.now()}.${pic.mime.includes('png') ? 'png' : 'jpg'}`);
    file.create({ overwrite: true });
    file.write(pic.data);
    lockFile = file;
    return file.uri;
  } catch (e) {
    return null;
  }
}

// The image to show for an artwork value: local covers are loaded; anything else is returned as is.
export function useArtwork(artwork) {
  const local = isLocalCover(artwork) ? artwork.slice(LOCAL_COVER.length) : null;
  const [loaded, setLoaded] = useState(() => (local && cache.has(local) ? { key: local, uri: cache.get(local) } : null));
  useEffect(() => {
    if (!local) return undefined;
    let alive = true;
    loadCover(local).then((uri) => { if (alive) setLoaded({ key: local, uri }); });
    return () => { alive = false; };
  }, [local]);
  if (!local) return artwork;
  return loaded?.key === local ? loaded.uri : null;
}
