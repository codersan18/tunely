// Browser version of fileReader.js: songs from "On this computer" are browser File objects,
// known by their blob: link (localFiles.web.js); anything else is fetched.
import { fileFor } from './localFiles';

async function blobOf(uri) {
  const known = fileFor(uri);
  if (known) return known;
  const res = await fetch(uri, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Couldn't read the file (${res.status})`);
  return res.blob();
}

export async function openReader(uri) {
  const blob = await blobOf(uri);
  return {
    size: blob.size,
    read: async (pos, len) => new Uint8Array(await blob.slice(pos, pos + len).arrayBuffer()),
    close: () => {},
  };
}

export function saveCoverForUpload(picture) {
  const ext = picture.mime.includes('png') ? 'png' : 'jpg';
  const file = new Blob([picture.data], { type: picture.mime });
  return { uri: URL.createObjectURL(file), file, name: `cover.${ext}`, mimeType: picture.mime };
}

// The browser's media controls take any image link: one blob: link for the playing song's cover.
let lockUrl = null;
export function writeLockScreenCover(pic) {
  if (lockUrl) { try { URL.revokeObjectURL(lockUrl); } catch (e) { /* gone */ } }
  lockUrl = pic ? URL.createObjectURL(new Blob([pic.data], { type: pic.mime })) : null;
  return lockUrl;
}
