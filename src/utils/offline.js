// Phone version of offline song storage: songs are saved as files in the app's documents folder.
// The browser version is offline.web.js (Expo picks it automatically on the web).

import { File, Directory, Paths } from 'expo-file-system';

const downloadsDir = () => {
  const dir = new Directory(Paths.document, 'downloads');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
};

const safeName = (id) => id.replace(/[^a-zA-Z0-9_-]/g, '_');

// Delete a local file if it exists (ignores web links and missing files).
export function deleteLocal(uri) {
  try { if (uri && !uri.startsWith('http')) { const f = new File(uri); if (f.exists) f.delete(); } } catch (e) { /* ignore */ }
}

// Download a song (and its cover) for offline listening. Returns the downloads entry.
export async function saveSong(track) {
  const target = new File(downloadsDir(), `${safeName(track.id)}.mp3`);
  const file = await File.downloadFileAsync(track.url, target, { idempotent: true });
  let size = 0;
  try { size = file.info().size || 0; } catch (e) { /* ignore */ }
  // Save the cover art too, so the song looks right with no internet.
  let saved = track;
  if (typeof track.artwork === 'string' && track.artwork.startsWith('http')) {
    try {
      const artTarget = new File(downloadsDir(), `${safeName(track.id)}.jpg`);
      const art = await File.downloadFileAsync(track.artwork, artTarget, { idempotent: true });
      saved = { ...track, artwork: art.uri, remoteArtwork: track.artwork };
      try { size += art.info().size || 0; } catch (e) { /* ignore */ }
    } catch (e) { /* keep the online artwork */ }
  }
  return { track: saved, uri: file.uri, size };
}

// A saved entry after an app restart, or null if its file has gone missing.
export async function restore(entry) {
  try { return new File(entry.uri).exists ? entry : null; } catch (e) { return null; }
}

export function removeSaved(entry) {
  deleteLocal(entry.uri);
  deleteLocal(entry.track.artwork);
}
