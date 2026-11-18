// The browser File behind each blob: link made for a song from "On this computer", so tags and
// covers can be read straight from the file. A file keeps the same link across rescans (songs
// already in the queue keep playing); links of files that are gone are released.
const byKey = new Map(); // path -> { url, file, stamp }
const byUrl = new Map(); // url -> File

export const fileFor = (url) => byUrl.get(url) || null;

export function linkFor(key, file) {
  const stamp = `${file.size}:${file.lastModified}`;
  const known = byKey.get(key);
  if (known && known.stamp === stamp) return known.url;
  if (known) { byUrl.delete(known.url); try { URL.revokeObjectURL(known.url); } catch (e) { /* gone */ } }
  const url = URL.createObjectURL(file);
  byKey.set(key, { url, file, stamp });
  byUrl.set(url, file);
  return url;
}

export function keepOnly(keys) {
  const keep = new Set(keys);
  for (const [key, { url }] of byKey) {
    if (keep.has(key)) continue;
    byKey.delete(key);
    byUrl.delete(url);
    try { URL.revokeObjectURL(url); } catch (e) { /* gone */ }
  }
}
