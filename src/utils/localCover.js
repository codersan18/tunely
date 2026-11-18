// Covers of songs saved on the phone ("On this phone"). The song's artwork is the marker
// `localcover:<file uri>`; the cover is read from the MP3's tag when it's shown and kept in memory
// only (nothing is written to the phone). The last few are remembered so scrolling back is instant.

import { useEffect, useState } from 'react';
import { readCover, readCoverDataUri } from './readTags';
import { writeLockScreenCover } from './fileReader';

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

// The lock screen (or the browser's media controls) can't read a cover from inside a song: for the
// song that's playing, the cover is saved as one small file (fileReader.js) and its link returned.
let lockKey = 0;
export async function lockScreenCover(artwork) {
  if (!isLocalCover(artwork)) return null;
  const key = ++lockKey;
  try {
    const pic = await readCover(artwork.slice(LOCAL_COVER.length));
    if (key !== lockKey) return null; // another song started meanwhile
    return writeLockScreenCover(pic);
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
