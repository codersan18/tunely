// Browser version of offline song storage (see offline.js for the phone).
// Songs and covers are kept in the browser's Cache Storage under their online URL.
// Songs play from a blob: URL made again each time the page opens; covers keep their normal
// URL and the service worker (public/sw.js) answers from this cache when there's no internet.

const CACHE = 'viberoom-downloads';

const open = () => caches.open(CACHE);

export function deleteLocal() { /* nothing outside the cache on the web */ }

async function store(cache, url) {
  // no-store: the cover may already be in the browser cache from an <img>, saved without the
  // CORS header this request needs (storage doesn't send "Vary: Origin"), which would fail.
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  await cache.put(url, new Response(blob, { headers: { 'content-type': blob.type || 'application/octet-stream' } }));
  return blob;
}

export async function saveSong(track) {
  // Ask the browser not to clear downloads when the disk gets full.
  try { await navigator.storage?.persist?.(); } catch (e) { /* ignore */ }
  const cache = await open();
  const blob = await store(cache, track.url);
  let size = blob.size;
  if (typeof track.artwork === 'string' && track.artwork.startsWith('http')) {
    try { size += (await store(cache, track.artwork)).size; } catch (e) { /* cover stays online-only */ }
  }
  return { track, uri: URL.createObjectURL(blob), size };
}

export async function restore(entry) {
  try {
    const res = await (await open()).match(entry.track.url);
    if (!res) return null;
    return { ...entry, uri: URL.createObjectURL(await res.blob()) };
  } catch (e) {
    return null;
  }
}

export function removeSaved(entry) {
  open().then((cache) => {
    cache.delete(entry.track.url);
    if (entry.track.artwork) cache.delete(entry.track.artwork);
  }).catch(() => {});
  try { URL.revokeObjectURL(entry.uri); } catch (e) { /* ignore */ }
}
