// Tunely's own song library, served by the Neon Function in /backend.
// Everyone who installs the app sees the same songs; only the admin can add or remove them.

import { uploadFile } from '../utils/files';

export const API_URL = 'https://br-polished-mud-azcthrf7-api.compute.c-3.ap-southeast-1.aws.neon.tech';

// Server song -> the track shape the player and UI use.
export function toTrack(s) {
  return {
    id: `song-${s.id}`,
    songId: s.id,
    title: s.title,
    artist: s.artist || 'Unknown artist',
    album: s.album || '',
    genre: s.genre || '',
    language: s.language || '',
    mood: s.mood || '',
    artwork: s.artwork || null,
    url: s.url,
    duration: s.duration,
    hash: s.hash,
    createdAt: s.createdAt,
  };
}

async function request(path, { method = 'GET', body, adminKey, signal } = {}) {
  const headers = {};
  if (body) headers['content-type'] = 'application/json';
  if (adminKey) headers['x-admin-key'] = adminKey;
  const res = await fetch(`${API_URL}${path}`, { method, headers, body: body && JSON.stringify(body), signal });
  let data = null;
  try { data = await res.json(); } catch (e) { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data?.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function fetchSongs(signal) {
  const { songs } = await request('/songs', { signal });
  return songs.map(toTrack);
}

// ---- admin ----

export async function verifyAdmin(adminKey) {
  try {
    await request('/admin/verify', { method: 'POST', adminKey });
    return true;
  } catch (e) {
    if (e.status === 401) return false;
    throw e;
  }
}

export function deleteSong(adminKey, songId) {
  return request(`/admin/songs/${songId}`, { method: 'DELETE', adminKey });
}

// How full song storage is: { used, limit, percent, full }. Uploads are blocked when full (90%).
export function getStorage(adminKey) {
  return request('/admin/storage', { adminKey });
}

// Change a song's details. Only the fields given are changed.
export async function updateSong(adminKey, songId, fields) {
  const { song } = await request(`/admin/songs/${songId}`, { method: 'PATCH', adminKey, body: fields });
  return toTrack(song);
}

const extOf = (name = '') => (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();

// Uploads one song. Throws an error with .duplicate = true if it already exists.
// item: { uri, file?, name, mimeType, size, hash, title, artist, album, genre, cover?: { uri, file?, name, mimeType } }
// (file is the browser File object, only on the web)
export async function uploadSong(adminKey, item, onStage = () => {}) {
  onStage('Checking');
  const prep = await request('/admin/prepare', {
    method: 'POST',
    adminKey,
    body: {
      hash: item.hash,
      title: item.title,
      artist: item.artist,
      ext: extOf(item.name),
      size: item.size,
      artworkExt: item.cover ? extOf(item.cover.name) || 'jpg' : undefined,
    },
  }).catch((e) => {
    if (e.status === 409) e.duplicate = true;
    throw e;
  });

  onStage('Uploading');
  const audio = await uploadFile(item, prep.audioUploadUrl, item.mimeType || 'audio/mpeg');
  if (audio >= 300) throw new Error(`Upload failed (${audio})`);

  if (item.cover && prep.artworkUploadUrl) {
    onStage('Uploading cover');
    const art = await uploadFile(item.cover, prep.artworkUploadUrl, item.cover.mimeType || 'image/jpeg');
    if (art >= 300) throw new Error(`Cover upload failed (${art})`);
  }

  onStage('Saving');
  const { song } = await request('/admin/songs', {
    method: 'POST',
    adminKey,
    body: {
      hash: item.hash,
      title: item.title,
      artist: item.artist,
      album: item.album,
      genre: item.genre,
      language: item.language,
      mood: item.mood,
      size: item.size,
      audioKey: prep.audioKey,
      artworkKey: item.cover ? prep.artworkKey : undefined,
    },
  }).catch((e) => {
    if (e.status === 409) e.duplicate = true;
    throw e;
  });
  return toTrack(song);
}
