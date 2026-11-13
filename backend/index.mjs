// Tunely backend: a single Neon Function (slug "api").
//
// Public:
//   GET    /songs                 -> every song, newest first
// Admin (header "x-admin-key: <ADMIN_KEY>"):
//   POST   /admin/verify          -> 200 if the key is right
//   POST   /admin/prepare         -> duplicate check + short-lived upload URLs
//   POST   /admin/songs           -> save the song after the files are uploaded
//   DELETE /admin/songs/:id       -> remove a song and its files
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

function presign(method, key, expires = UPLOAD_URL_TTL) {
  const endpoint = new URL(process.env.AWS_ENDPOINT_URL_S3);
  const region = process.env.AWS_REGION;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/s3/aws4_request`;
  const path = `/${BUCKET}/${encodeKey(key)}`;

  const q = {
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

// Bucket is public_read, so files are readable at a plain URL.
const publicUrl = (key) => (key ? `${new URL(process.env.AWS_ENDPOINT_URL_S3).origin}/${BUCKET}/${encodeKey(key)}` : null);

const toSong = (r) => ({
  id: r.id,
  title: r.title,
  artist: r.artist,
  album: r.album,
  genre: r.genre,
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
      `INSERT INTO songs (title, artist, album, genre, duration, audio_key, artwork_key, content_hash, size_bytes)
       VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), $5, $6, $7, $8, $9)
       RETURNING *`,
      [title, artist, clean(body.album), clean(body.genre, 60), duration, audioKey, artworkKey, hash, size],
    );
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

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (request.method === 'GET' && (path === '/songs' || path === '/')) return await listSongs();

      if (path.startsWith('/admin/')) {
        if (!isAdmin(request)) {
          await new Promise((r) => setTimeout(r, 800)); // slow down password guessing
          return json(401, { error: 'unauthorized', message: 'Wrong admin password.' });
        }
        if (request.method === 'POST' && path === '/admin/verify') return json(200, { ok: true });
        if (request.method === 'POST' && path === '/admin/prepare') return await prepare(await request.json());
        if (request.method === 'POST' && path === '/admin/songs') return await saveSong(await request.json());
        const m = path.match(/^\/admin\/songs\/([^/]+)$/);
        if (request.method === 'DELETE' && m) return await deleteSong(m[1]);
      }
      return json(404, { error: 'not_found' });
    } catch (e) {
      console.error(e);
      return json(500, { error: 'server_error', message: 'Something went wrong on the server.' });
    }
  },
};
