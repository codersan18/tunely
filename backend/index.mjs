// Tunely backend: a single Neon Function (slug "api").
//
// Public:
//   GET    /songs                 -> every song, newest first
// Admin (header "x-admin-key: <ADMIN_KEY>"):
//   POST   /admin/verify          -> 200 if the key is right
//   POST   /admin/prepare         -> duplicate check + short-lived upload URLs
//   POST   /admin/songs           -> save the song after the files are uploaded
//   PATCH  /admin/songs/:id       -> edit a song's details (title, artist, album, genre, language, mood)
//   DELETE /admin/songs/:id       -> remove a song and its files
//   GET    /admin/storage         -> how full object storage is; uploads stop at 90%
// Song compression (run by .github/workflows/optimize.yml):
//   GET    /admin/optimize/pending        -> songs not yet compressed
//   POST   /admin/optimize/:id/prepare    -> upload URLs for the compressed audio (+ cover found in the file)
//   POST   /admin/optimize/:id/done       -> switch the song to the compressed file, delete the original
//
// No dependencies: Postgres via Neon's HTTP SQL endpoint, S3 URLs signed with node:crypto.
// Neon injects DATABASE_URL and AWS_* at runtime. ADMIN_KEY is set at deploy time.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const BUCKET = 'songs';
const UPLOAD_URL_TTL = 15 * 60; // seconds
const MAX_AUDIO_BYTES = 60 * 1024 * 1024;
const AUDIO_EXT = new Set(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac', 'opus']);
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp']);

// ---------- helpers ----------

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

const sha256hex = (s) => createHash('sha256').update(s).digest('hex');
const hmac = (key, s) => createHmac('sha256', key).update(s).digest();

function isAdmin(request) {
  const expected = process.env.ADMIN_KEY;
  const given = request.headers.get('x-admin-key');
  if (!expected || !given) return false;
  // Compare hashes so lengths match and timing doesn't leak the key.
  return timingSafeEqual(createHash('sha256').update(given).digest(), createHash('sha256').update(expected).digest());
}

const clean = (v, max = 200) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');

// ---------- Postgres over HTTP ----------

async function sql(query, params = []) {
  const url = new URL(process.env.DATABASE_URL);
  const res = await fetch(`https://${url.hostname}/sql`, {
    method: 'POST',
    headers: { 'Neon-Connection-String': process.env.DATABASE_URL, 'content-type': 'application/json' },
    body: JSON.stringify({ query, params }),
  });
  const body = await res.json();
  if (!res.ok) {
    const err = new Error(body.message || `SQL failed (${res.status})`);
    err.code = body.code;
    err.constraint = body.constraint;
    throw err;
  }
  return body.rows;
}

// ---------- S3 presigned URLs (SigV4, path-style) ----------

const encodeKey = (key) => key.split('/').map((p) => encodeURIComponent(p)).join('/');

// key '' signs a request on the bucket itself (e.g. listing); extra = additional query parameters.
function presign(method, key, expires = UPLOAD_URL_TTL, extra = {}) {
  const endpoint = new URL(process.env.AWS_ENDPOINT_URL_S3);
  const region = process.env.AWS_REGION;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const path = key ? `/${BUCKET}/${encodeKey(key)}` : `/${BUCKET}`;

  const q = {
    ...extra,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${process.env.AWS_ACCESS_KEY_ID}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  };
  if (process.env.AWS_SESSION_TOKEN) q['X-Amz-Security-Token'] = process.env.AWS_SESSION_TOKEN;
  const query = Object.keys(q).sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(q[k])}`).join('&');

  const canonical = [method, path, query, `host:${endpoint.host}`, '', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');
  let k = hmac(`AWS4${process.env.AWS_SECRET_ACCESS_KEY}`, day);
  k = hmac(k, region);
  k = hmac(k, 's3');
  k = hmac(k, 'aws4_request');
  const signature = createHmac('sha256', k).update(toSign).digest('hex');
  return `${endpoint.origin}${path}?${query}&X-Amz-Signature=${signature}`;
}

// ---------- storage usage ----------

// Free plan object storage is 5 GB per project. Uploads stop at 90% so there's always room
// for the compression job (it writes the small copy before deleting the original).
const STORAGE_LIMIT_BYTES = Number(process.env.STORAGE_LIMIT_BYTES) || 5e9;
const STORAGE_STOP_AT = 0.9;

// Total size of everything in the bucket, straight from storage (the Neon dashboard lags).
async function storageUsed() {
  let total = 0;
  let objects = 0;
  let token = null;
  for (let page = 0; page < 200; page += 1) {
    const extra = { 'list-type': '2', 'max-keys': '1000' };
    if (token) extra['continuation-token'] = token;
    const res = await fetch(presign('GET', '', 60, extra));
    const xml = await res.text();
    if (!res.ok) throw new Error(`storage listing failed (${res.status}): ${xml.slice(0, 200)}`);
    for (const m of xml.matchAll(/<Size>(\d+)<\/Size>/g)) { total += Number(m[1]); objects += 1; }
    token = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1];
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml) || !token) break;
  }
  return { used: total, objects, limit: STORAGE_LIMIT_BYTES, stopAt: STORAGE_STOP_AT };
}

async function storageStatus() {
  const s = await storageUsed();
  return json(200, { ...s, percent: Math.round((s.used / s.limit) * 1000) / 10, full: s.used >= s.limit * s.stopAt });
}

// Bucket is public_read, so files are readable at a plain URL.
const publicUrl = (key) => (key ? `${new URL(process.env.AWS_ENDPOINT_URL_S3).origin}/${BUCKET}/${encodeKey(key)}` : null);

const toSong = (r) => ({
  id: r.id,
  title: r.title,
  artist: r.artist,
  album: r.album,
  genre: r.genre,
  language: r.language, // used by smart shuffle
  mood: r.mood,
  duration: r.duration == null ? null : Number(r.duration),
  size: r.size_bytes == null ? null : Number(r.size_bytes),
  url: publicUrl(r.audio_key),
  artwork: publicUrl(r.artwork_key),
  hash: r.content_hash, // lets the app spot a duplicate before uploading
  createdAt: r.created_at,
});

// Is there already a song with this exact file, or the same title + artist?
async function findDuplicate(hash, title, artist) {
  const rows = await sql(
    `SELECT id, title, artist, (content_hash = $1) AS same_file FROM songs
      WHERE content_hash = $1
         OR (title_key = lower(regexp_replace(trim($2), '\\s+', ' ', 'g'))
             AND artist_key = lower(regexp_replace(trim($3), '\\s+', ' ', 'g')))
      LIMIT 1`,
    [hash, title, artist],
  );
  if (!rows.length) return null;
  const r = rows[0];
  const sameFile = r.same_file === true || r.same_file === 't' || r.same_file === 'true';
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    reason: sameFile ? 'same_file' : 'same_title_artist',
  };
}

const duplicateResponse = (dup) => json(409, {
  error: 'duplicate',
  reason: dup.reason,
  message: dup.reason === 'same_file'
    ? `This file is already uploaded as "${dup.title}" by ${dup.artist}.`
    : `"${dup.title}" by ${dup.artist} is already in the library.`,
  existing: { id: dup.id, title: dup.title, artist: dup.artist },
});

// ---------- routes ----------

async function listSongs() {
  const rows = await sql('SELECT * FROM songs ORDER BY created_at DESC');
  return json(200, { songs: rows.map(toSong) });
}

async function prepare(body) {
  const hash = clean(body.hash, 128).toLowerCase();
  const title = clean(body.title);
  const artist = clean(body.artist) || 'Unknown artist';
  const ext = clean(body.ext, 8).toLowerCase();
  const artworkExt = clean(body.artworkExt, 8).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) return json(400, { error: 'bad_hash', message: 'Missing file fingerprint.' });
  if (!title) return json(400, { error: 'bad_title', message: 'Title is required.' });
  if (!AUDIO_EXT.has(ext)) return json(400, { error: 'bad_type', message: `Unsupported audio type ".${ext}".` });
  if (body.size && Number(body.size) > MAX_AUDIO_BYTES) {
    return json(400, { error: 'too_big', message: 'Audio files must be under 60 MB.' });
  }

  const dup = await findDuplicate(hash, title, artist);
  if (dup) return duplicateResponse(dup);

  // Stop new uploads once storage is 90% full (counting this file).
  const store = await storageUsed();
  const incoming = Number(body.size) || 0;
  if (store.used + incoming >= store.limit * store.stopAt) {
    const pct = Math.round((store.used / store.limit) * 100);
    const size = (b) => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);
    return json(507, {
      error: 'storage_full',
      message: `Storage is ${pct}% full (${size(store.used)} of ${size(store.limit)}). `
        + 'New uploads are paused at 90%. Delete some songs to make room.',
      used: store.used,
      limit: store.limit,
    });
  }

  const audioKey = `audio/${hash}.${ext}`;
  const out = { audioKey, audioUploadUrl: presign('PUT', audioKey) };
  if (artworkExt) {
    if (!IMAGE_EXT.has(artworkExt)) return json(400, { error: 'bad_image', message: 'Cover must be JPG, PNG or WebP.' });
    out.artworkKey = `art/${hash}.${artworkExt === 'jpeg' ? 'jpg' : artworkExt}`;
    out.artworkUploadUrl = presign('PUT', out.artworkKey);
  }
  return json(200, out);
}

async function saveSong(body) {
  const hash = clean(body.hash, 128).toLowerCase();
  const title = clean(body.title);
  const artist = clean(body.artist) || 'Unknown artist';
  const audioKey = clean(body.audioKey, 300);
  const artworkKey = clean(body.artworkKey, 300) || null;
  if (!/^[a-f0-9]{64}$/.test(hash) || !title) return json(400, { error: 'bad_request', message: 'Missing song details.' });
  if (!audioKey.startsWith(`audio/${hash}.`)) return json(400, { error: 'bad_key', message: 'Audio key does not match file.' });
  if (artworkKey && !artworkKey.startsWith(`art/${hash}.`)) return json(400, { error: 'bad_key', message: 'Cover key does not match file.' });

  // Make sure the audio really landed in storage before listing it.
  const head = await fetch(publicUrl(audioKey), { method: 'HEAD' });
  if (!head.ok) return json(400, { error: 'not_uploaded', message: 'The audio file did not finish uploading. Try again.' });
  const size = Number(head.headers.get('content-length')) || Number(body.size) || null;

  const duration = Number.isFinite(Number(body.duration)) && Number(body.duration) > 0 ? Math.round(Number(body.duration)) : null;

  try {
    const rows = await sql(
      `INSERT INTO songs (title, artist, album, genre, language, mood, duration, audio_key, artwork_key, content_hash, size_bytes)
       VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), NULLIF($5, ''), NULLIF($6, ''), $7, $8, $9, $10, $11)
       RETURNING *`,
      [title, artist, clean(body.album), clean(body.genre, 60), clean(body.language, 40), clean(body.mood, 40),
        duration, audioKey, artworkKey, hash, size],
    );
    await startCompression();
    return json(201, { song: toSong(rows[0]) });
  } catch (e) {
    // Unique constraint hit: someone added the same song a moment ago.
    if (e.code === '23505') {
      const dup = await findDuplicate(hash, title, artist);
      if (dup) return duplicateResponse(dup);
    }
    throw e;
  }
}

// Only the fields sent are changed. Empty strings clear optional fields.
const EDITABLE = { title: 200, artist: 200, album: 200, genre: 60, language: 40, mood: 40 };

async function editSong(id, body) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: 'bad_id' });
  const sets = [];
  const params = [id];
  for (const [field, max] of Object.entries(EDITABLE)) {
    if (!(field in body)) continue;
    let v = clean(body[field], max);
    if (field === 'title' && !v) return json(400, { error: 'bad_title', message: 'Title is required.' });
    if (field === 'artist' && !v) v = 'Unknown artist';
    params.push(v);
    sets.push(field === 'title' || field === 'artist' ? `${field} = $${params.length}` : `${field} = NULLIF($${params.length}, '')`);
  }
  if (!sets.length) return json(400, { error: 'nothing_to_change' });
  try {
    const rows = await sql(`UPDATE songs SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
    if (!rows.length) return json(404, { error: 'not_found' });
    return json(200, { song: toSong(rows[0]) });
  } catch (e) {
    if (e.code === '23505') {
      return json(409, { error: 'duplicate', reason: 'same_title_artist', message: 'Another song already has this title and artist.' });
    }
    throw e;
  }
}

// ---------- compression ----------

const idOk = (id) => /^[0-9a-f-]{36}$/i.test(id);

// Delete a stored file unless another song still uses it.
async function deleteIfUnused(key) {
  if (!key) return;
  const still = await sql('SELECT 1 FROM songs WHERE audio_key = $1 OR artwork_key = $1 LIMIT 1', [key]);
  if (!still.length) await fetch(presign('DELETE', key, 60), { method: 'DELETE' }).catch(() => {});
}

async function optimizePending() {
  const rows = await sql('SELECT * FROM songs WHERE NOT optimized ORDER BY created_at LIMIT 20');
  return json(200, { songs: rows.map((r) => ({ ...toSong(r), audioKey: r.audio_key, hasArtwork: !!r.artwork_key })) });
}

async function optimizePrepare(id, body) {
  if (!idOk(id)) return json(400, { error: 'bad_id' });
  const rows = await sql('SELECT content_hash, artwork_key FROM songs WHERE id = $1', [id]);
  if (!rows.length) return json(404, { error: 'not_found' });
  const hash = rows[0].content_hash;
  const out = {};
  const ext = clean(body.ext, 8).toLowerCase();
  if (ext) {
    if (!AUDIO_EXT.has(ext)) return json(400, { error: 'bad_type' });
    // ".c" marks the compressed copy; the hash stays the original file's, so re-uploading it is still a duplicate.
    out.audioKey = `audio/${hash}.c.${ext}`;
    out.audioUploadUrl = presign('PUT', out.audioKey);
  }
  const artExt = clean(body.artworkExt, 8).toLowerCase();
  if (artExt && !rows[0].artwork_key) {
    if (!IMAGE_EXT.has(artExt)) return json(400, { error: 'bad_image' });
    out.artworkKey = `art/${hash}.${artExt === 'jpeg' ? 'jpg' : artExt}`;
    out.artworkUploadUrl = presign('PUT', out.artworkKey);
  }
  return json(200, out);
}

async function optimizeDone(id, body) {
  if (!idOk(id)) return json(400, { error: 'bad_id' });
  const rows = await sql('SELECT * FROM songs WHERE id = $1', [id]);
  if (!rows.length) return json(404, { error: 'not_found' });
  const song = rows[0];
  const hash = song.content_hash;
  const duration = Number(body.duration) > 0 ? Math.round(Number(body.duration)) : null;

  let audioKey = song.audio_key;
  let size = song.size_bytes == null ? null : Number(song.size_bytes);
  const newAudio = clean(body.audioKey, 300);
  if (newAudio) {
    if (!newAudio.startsWith(`audio/${hash}.c.`)) return json(400, { error: 'bad_key' });
    const head = await fetch(publicUrl(newAudio), { method: 'HEAD' });
    if (!head.ok) return json(400, { error: 'not_uploaded', message: 'Compressed file is not in storage.' });
    audioKey = newAudio;
    size = Number(head.headers.get('content-length')) || size;
  }
  let artworkKey = song.artwork_key;
  const newArt = clean(body.artworkKey, 300);
  if (newArt && !artworkKey) {
    if (!newArt.startsWith(`art/${hash}.`)) return json(400, { error: 'bad_key' });
    const head = await fetch(publicUrl(newArt), { method: 'HEAD' });
    if (head.ok) artworkKey = newArt;
  }

  const updated = await sql(
    `UPDATE songs SET audio_key = $2, size_bytes = $3, artwork_key = $4,
       duration = COALESCE(duration, $5), optimized = true,
       original_size = COALESCE(original_size, $6)
     WHERE id = $1 RETURNING *`,
    [id, audioKey, size, artworkKey, duration, song.size_bytes],
  );
  if (audioKey !== song.audio_key) await deleteIfUnused(song.audio_key);
  return json(200, { song: toSong(updated[0]), before: Number(song.size_bytes) || null, after: size });
}

async function deleteSong(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: 'bad_id' });
  const rows = await sql('DELETE FROM songs WHERE id = $1 RETURNING audio_key, artwork_key, content_hash', [id]);
  if (!rows.length) return json(404, { error: 'not_found' });
  const { audio_key: audio, artwork_key: art } = rows[0];
  // Only remove the files if no other row points at them.
  for (const key of [audio, art].filter(Boolean)) {
    const still = await sql('SELECT 1 FROM songs WHERE audio_key = $1 OR artwork_key = $1 LIMIT 1', [key]);
    if (!still.length) await fetch(presign('DELETE', key, 60), { method: 'DELETE' }).catch(() => {});
  }
  return json(200, { deleted: id });
}

// ---------- automatic compression ----------
// After a song is added, ask GitHub to run the "Compress new songs" workflow straight away
// (.github/workflows/optimize.yml). Needs GITHUB_TOKEN: a fine-grained token with
// "Actions: read and write" on the repo only. Without it, the workflow's 15-minute timer is
// the only trigger. Several uploads in a row send one request per 20 seconds; the workflow
// keeps going until no songs are left, so it also picks up songs added while it runs.

const GITHUB_REPO = process.env.GITHUB_REPO || 'codersan18/tunely';
let lastCompressionStart = 0;

async function startCompression() {
  const token = process.env.GITHUB_TOKEN;
  if (!token || Date.now() - lastCompressionStart < 20_000) return;
  lastCompressionStart = Date.now();
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/optimize.yml/dispatches`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'viberoom-backend',
      },
      body: JSON.stringify({ ref: 'main' }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.status !== 204) console.error('Could not start compression:', res.status, (await res.text()).slice(0, 200));
  } catch (e) {
    console.error('Could not start compression:', e.message); // the song is saved either way
  }
}

// The web version of VibeRoom calls this API from a browser, which needs CORS headers.
// Admin routes still need the admin password in the x-admin-key header (no cookies are used,
// so allowing any origin doesn't let other sites act as the admin).
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, x-admin-key',
  'access-control-max-age': '86400',
};

async function route(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
      if (request.method === 'GET' && (path === '/songs' || path === '/')) return await listSongs();

      if (path.startsWith('/admin/')) {
        if (!isAdmin(request)) {
          await new Promise((r) => setTimeout(r, 800)); // slow down password guessing
          return json(401, { error: 'unauthorized', message: 'Wrong admin password.' });
        }
        if (request.method === 'POST' && path === '/admin/verify') return json(200, { ok: true });
        if (request.method === 'POST' && path === '/admin/prepare') return await prepare(await request.json());
        if (request.method === 'POST' && path === '/admin/songs') return await saveSong(await request.json());
        if (request.method === 'GET' && path === '/admin/storage') return await storageStatus();
        if (request.method === 'GET' && path === '/admin/optimize/pending') return await optimizePending();
        const o = path.match(/^\/admin\/optimize\/([^/]+)\/(prepare|done)$/);
        if (request.method === 'POST' && o) {
          return await (o[2] === 'prepare' ? optimizePrepare : optimizeDone)(o[1], await request.json());
        }
        const m = path.match(/^\/admin\/songs\/([^/]+)$/);
        if (request.method === 'DELETE' && m) return await deleteSong(m[1]);
        if (request.method === 'PATCH' && m) return await editSong(m[1], await request.json());
      }
      return json(404, { error: 'not_found' });
    } catch (e) {
      console.error(e);
      return json(500, { error: 'server_error', message: 'Something went wrong on the server.' });
    }
}

export default {
  async fetch(request) {
    const res = await route(request);
    for (const [k, v] of Object.entries(CORS)) res.headers.set(k, v);
    return res;
  },
};
