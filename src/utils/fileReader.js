// Reading parts of audio files and saving small pictures: the phone version (expo-file-system).
// The browser version is fileReader.web.js. Used by readTags.js and localCover.js.
import { Directory, File, FileMode, Paths } from 'expo-file-system';

/** Opens a file for reading pieces of it: { size, read(position, length) → Uint8Array, close() }. */
export async function openReader(uri) {
  const h = new File(uri).open(FileMode.ReadOnly);
  return {
    size: h.size || 0,
    read: async (pos, len) => { h.offset = pos; return h.readBytes(len); },
    close: () => h.close(),
  };
}

/** Saves a cover picture from a song's tags for the upload form: { uri, name, mimeType }. */
export function saveCoverForUpload(picture) {
  const ext = picture.mime.includes('png') ? 'png' : 'jpg';
  const cover = new File(Paths.cache, `tag-cover-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`);
  cover.create({ overwrite: true });
  cover.write(picture.data);
  return { uri: cover.uri, name: `cover.${ext}`, mimeType: picture.mime };
}

// The lock screen can only show a cover from a web link or a file: the playing song's cover is
// written to one small file in the cache (the previous one is deleted).
let lockFile = null;
let cleaned = false;
export function writeLockScreenCover(pic) {
  if (!cleaned) { // covers left behind if the app was closed mid-song
    cleaned = true;
    try {
      new Directory(Paths.cache).list()
        .filter((f) => f instanceof File && f.name?.startsWith('lockscreen-cover-'))
        .forEach((f) => f.delete());
    } catch (e) { /* nothing to clean */ }
  }
  try { if (lockFile?.exists) lockFile.delete(); } catch (e) { /* already gone */ }
  lockFile = null;
  if (!pic) return null;
  // A new name each time: the lock screen skips loading a link it has already shown.
  const file = new File(Paths.cache, `lockscreen-cover-${Date.now()}.${pic.mime.includes('png') ? 'png' : 'jpg'}`);
  file.create({ overwrite: true });
  file.write(pic.data);
  lockFile = file;
  return file.uri;
}
