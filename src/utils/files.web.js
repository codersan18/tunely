// Browser version of the file helpers used by the upload screen (see files.js for the phone).
// Picked files arrive as browser File objects (asset.file), so everything is read in memory.

import { parseID3, tagsToDetails } from './readTags';

// The admin password, kept in this browser. "Lock" in Manage songs removes it.
export const keyStore = {
  get: async (name) => { try { return localStorage.getItem(name); } catch (e) { return null; } },
  set: async (name, value) => { localStorage.setItem(name, value); },
  remove: async (name) => { try { localStorage.removeItem(name); } catch (e) { /* ignore */ } },
};

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

// The browser File for a picked asset (or a cover we made from the song's tags).
const blobOf = (source) => {
  if (source.file) return Promise.resolve(source.file);
  return fetch(source.uri).then((r) => r.blob()); // blob: URL
};

export async function fileHash(asset) {
  const data = await (await blobOf(asset)).arrayBuffer();
  return hex(await crypto.subtle.digest('SHA-256', data));
}

const MAX_TAG_BYTES = 4 * 1024 * 1024;
const syncsafe = (b, o) => (b[o] << 21) | (b[o + 1] << 14) | (b[o + 2] << 7) | b[o + 3];

export async function fileTags(asset) {
  const blob = await blobOf(asset);
  const head = new Uint8Array(await blob.slice(0, 10).arrayBuffer());
  if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return null;
  const size = syncsafe(head, 6);
  if (size <= 0 || size > MAX_TAG_BYTES) return null;
  const bytes = new Uint8Array(await blob.slice(0, 10 + size).arrayBuffer());

  const details = tagsToDetails(parseID3(bytes));
  if (!details) return null;
  if (details.picture) {
    const ext = details.picture.mime.includes('png') ? 'png' : 'jpg';
    const file = new Blob([details.picture.data], { type: details.picture.mime });
    details.cover = { uri: URL.createObjectURL(file), file, name: `cover.${ext}`, mimeType: details.picture.mime };
  }
  delete details.picture;
  return details;
}

export async function uploadFile(source, url, contentType) {
  const res = await fetch(url, { method: 'PUT', headers: { 'content-type': contentType }, body: await blobOf(source) });
  return res.status;
}
