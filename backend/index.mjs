// Tunely backend: a single Neon Function (slug "api").
//
// Public:
//   GET    /songs                 -> every song, newest first
//   POST   /plays                 -> count a play { songId, device } (once per device + song per 10 min)
//   GET    /popular?days=&limit=  -> most played songs lately [{ id, plays }]
//   POST   /requests              -> a listener asks for a song { device, title, artist?, note? }
// Accounts (Neon Auth; the app keeps the returned `session` and sends it as header "x-session"):
//   POST   /auth/sign-up          -> { email, password, name } -> { session, user }
//   POST   /auth/sign-in          -> { email, password } -> { session, user }
//   POST   /auth/google           -> { callbackURL } -> { url, challenge }  (open url; Google returns to callbackURL)
//   POST   /auth/google/finish    -> { verifier, challenge } -> { session, user }
//   POST   /auth/google/handoff   -> { handoff, verifier }   (phone sign-in: the website's return page leaves the code)
//   POST   /auth/google/claim     -> { handoff, verifier? } -> { session, user } | { pending: true }
//   POST   /auth/session          -> { session } -> { user } or 401 when signed out
//   POST   /auth/sign-out         -> { session }
//   POST   /auth/forgot           -> { email }: emails a 6-digit code (same answer whether or not the account exists)
//   POST   /auth/reset            -> { email, code, password } -> new password, then { session, user }
//   POST   /me/library            -> sync likes, playlists, recently played and stats (see mergeLibrary)
//   POST   /me/profile            -> { nickname } -> { user } (apps from before profiles)
//   POST   /me/profiles           -> { profiles: [{ id, name, avatar, main }] } (up to 6; "main" made on first use)
//   POST   /me/profiles/save      -> { id?, name, avatar } -> { profiles } (no id = new profile)
//   POST   /me/profiles/delete    -> { id } -> { profiles } (also deletes that profile's library)
//   /me/library takes { profileId } (default "main"): each profile syncs its own library
// Admin (header "x-admin-key: <ADMIN_KEY>"):
//   POST   /admin/verify          -> 200 if the key is right
//   POST   /admin/prepare         -> duplicate check + short-lived upload URLs
//   POST   /admin/songs           -> save the song after the files are uploaded
//   PATCH  /admin/songs/:id       -> edit a song's details (title, artist, album, genre, language, mood)
//   DELETE /admin/songs/:id       -> remove a song and its files
//   GET    /admin/storage         -> how full object storage is; uploads stop at 90%
//   GET    /admin/requests        -> song requests, open ones first
//   PATCH  /admin/requests/:id    -> { done: true|false }
//   DELETE /admin/requests/:id    -> remove a request
// Song compression (run by .github/workflows/optimize.yml):
//   GET    /admin/optimize/pending        -> songs not yet compressed
//   POST   /admin/optimize/:id/prepare    -> upload URLs for the compressed audio (+ cover found in the file)
//   POST   /admin/optimize/:id/done       -> switch the song to the compressed file, delete the original
//
// No dependencies: Postgres via Neon's HTTP SQL endpoint, S3 URLs signed with node:crypto.
// Neon injects DATABASE_URL, AWS_* and NEON_AUTH_BASE_URL at runtime. ADMIN_KEY is set at deploy time.

import { createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';

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

// ---------- plays and popular songs ----------
// Tables: plays (song_id, device, played_at), song_requests (see backend/README.md).

const deviceOk = (d) => typeof d === 'string' && /^[a-z0-9]{6,40}$/i.test(d);

async function addPlay(body) {
  const songId = clean(body.songId, 40);
  if (!idOk(songId) || !deviceOk(body.device)) return json(400, { error: 'bad_request' });
  // Once per device + song per 10 minutes, and only for songs that exist.
  await sql(
    `INSERT INTO plays (song_id, device)
       SELECT $1::uuid, $2
        WHERE EXISTS (SELECT 1 FROM songs WHERE id = $1::uuid)
          AND NOT EXISTS (SELECT 1 FROM plays WHERE device = $2 AND song_id = $1::uuid
                                              AND played_at > now() - interval '10 minutes')`,
    [songId, body.device],
  );
  return json(200, { ok: true });
}

async function popular(url) {
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 7));
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));
  const rows = await sql(
    `SELECT song_id AS id, count(*)::int AS plays FROM plays
      WHERE played_at > now() - make_interval(days => $1)
      GROUP BY song_id ORDER BY plays DESC, max(played_at) DESC LIMIT $2`,
    [days, limit],
  );
  return json(200, { songs: rows.map((r) => ({ id: r.id, plays: Number(r.plays) })) });
}

// ---------- song requests ----------

const toRequest = (r) => ({
  id: r.id, title: r.title, artist: r.artist, note: r.note,
  done: r.done === true || r.done === 't' || r.done === 'true', createdAt: r.created_at,
});

async function addRequest(body) {
  const title = clean(body.title, 120);
  if (!title || !deviceOk(body.device)) return json(400, { error: 'bad_request', message: 'Please type the song title.' });
  const recent = await sql(
    `SELECT count(*)::int AS n FROM song_requests WHERE device = $1 AND created_at > now() - interval '1 day'`,
    [body.device],
  );
  if (Number(recent[0]?.n) >= 5) {
    return json(429, { error: 'too_many', message: 'You can ask for 5 songs a day. Try again tomorrow.' });
  }
  const rows = await sql(
    'INSERT INTO song_requests (title, artist, note, device) VALUES ($1, $2, $3, $4) RETURNING *',
    [title, clean(body.artist, 120) || null, clean(body.note, 300) || null, body.device],
  );
  return json(200, { request: toRequest(rows[0]) });
}

async function listRequests() {
  const rows = await sql('SELECT * FROM song_requests ORDER BY done, created_at DESC LIMIT 300');
  return json(200, { requests: rows.map(toRequest) });
}

async function updateRequest(id, body) {
  if (!idOk(id)) return json(400, { error: 'bad_id' });
  const rows = await sql('UPDATE song_requests SET done = $2 WHERE id = $1 RETURNING *', [id, body.done === true]);
  return rows.length ? json(200, { request: toRequest(rows[0]) }) : json(404, { error: 'not_found' });
}

async function removeRequest(id) {
  if (!idOk(id)) return json(400, { error: 'bad_id' });
  const rows = await sql('DELETE FROM song_requests WHERE id = $1 RETURNING id', [id]);
  return rows.length ? json(200, { deleted: id }) : json(404, { error: 'not_found' });
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
// ---------- accounts (Neon Auth) ----------
// The app never talks to Neon Auth itself: these endpoints do it and hand the app a session string
// (the value of Neon Auth's session cookie). The app keeps it in secure storage and sends it as
// "x-session". Cookies are handled here because phones and some browsers (Safari) can't keep
// Neon Auth's cookie for the app.

const AUTH_BASE = () => process.env.NEON_AUTH_BASE_URL || 'https://ep-snowy-forest-azystcn6.neonauth.c-3.ap-southeast-1.aws.neon.tech/neondb/auth';
const AUTH_ORIGIN = 'https://viberoom.expo.app'; // a trusted domain in Neon Auth
const SESSION_COOKIE = '__Secure-neon-auth.session_token';
const CHALLENGE_MARKERS = ['.session_challenge', '.session_challange'];
const CALLBACK_OK = /^(https:\/\/viberoom\.expo\.app|http:\/\/localhost(:\d+)?)\/auth\/callback(\?|$)/;

function setCookies(res) {
  const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : (res.headers.get('set-cookie') || '').split(/,(?=\s*[^;,=\s]+=)/);
  const out = {};
  for (const c of list) {
    const pair = c.split(';')[0];
    const i = pair.indexOf('=');
    if (i < 1) continue;
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    const expired = !value || /max-age=(-\d+|0)\b/i.test(c);
    out[name] = expired ? null : value;
  }
  return out;
}

async function authCall(method, path, { body, cookie, query, ip } = {}) {
  const u = new URL(AUTH_BASE() + path);
  for (const [k, v] of Object.entries(query || {})) u.searchParams.set(k, v);
  const headers = { origin: AUTH_ORIGIN, accept: 'application/json' };
  if (body) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (ip) headers['x-forwarded-for'] = ip;
  const res = await fetch(u, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
  return { ok: res.ok, status: res.status, data, cookies: setCookies(res) };
}

const publicUser = (u) => (u ? { id: u.id, name: u.name || '', email: u.email || '', image: u.image || null } : null);
const clientIp = (request) => (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || undefined;

// Friendly messages for Neon Auth's error codes.
const AUTH_MESSAGES = {
  USER_ALREADY_EXISTS: 'There is already an account with this email. Sign in instead.',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'There is already an account with this email. Sign in instead.',
  INVALID_EMAIL_OR_PASSWORD: 'Wrong email or password.',
  INVALID_EMAIL: 'That email address doesn\'t look right.',
  PASSWORD_TOO_SHORT: 'Use a password of at least 8 characters.',
  PASSWORD_TOO_LONG: 'That password is too long.',
  INVALID_OTP: 'That code isn\'t right. Check the email and try again.',
  OTP_EXPIRED: 'That code has expired. Ask for a new one.',
  TOO_MANY_ATTEMPTS: 'Too many wrong codes. Ask for a new one.',
  USER_NOT_FOUND: 'That code isn\'t right. Check the email and try again.',
};
function authError(r) {
  const code = r.data?.code || (r.status === 429 ? 'TOO_MANY_REQUESTS' : 'AUTH_FAILED');
  const message = AUTH_MESSAGES[code] || (r.status === 429 ? 'Too many tries. Wait a minute and try again.' : r.data?.message || 'Sign-in failed. Try again.');
  return json(r.status >= 500 ? 502 : r.status === 429 ? 429 : 400, { error: code, message });
}

// The signed-in user for a session string, or null. Remembered for a few minutes per instance.
const sessionCache = new Map(); // session -> { user, until }
async function userForSession(session, ip) {
  if (!session || typeof session !== 'string' || session.length > 1000) return null;
  const hit = sessionCache.get(session);
  if (hit && hit.until > Date.now()) return hit.user;
  const r = await authCall('GET', '/get-session', { cookie: `${SESSION_COOKIE}=${session}`, query: { disableCookieCache: 'true' }, ip });
  const user = r.ok && r.data?.user ? publicUser(r.data.user) : null;
  if (sessionCache.size > 5000) sessionCache.clear();
  if (user) sessionCache.set(session, { user, until: Date.now() + 5 * 60 * 1000 });
  else sessionCache.delete(session);
  return user;
}

// The account plus what the person set in VibeRoom (user_profile): their nickname, used in the
// app's greeting ("Good morning, <nickname>") on every device.
async function withProfile(user) {
  const rows = await sql('SELECT nickname FROM user_profile WHERE user_id = $1', [user.id]).catch(() => []);
  return { ...user, nickname: rows[0]?.nickname || '' };
}

async function signedIn(session, ip) {
  const user = await userForSession(session, ip);
  if (!user) return json(502, { error: 'no_session', message: 'Signed in, but the session could not be read. Try again.' });
  return json(200, { session, user: await withProfile(user) });
}

const NICKNAME_MAX = 30;

async function updateProfile(body, user) {
  // One line, no control characters; empty clears it (the greeting then uses the first name).
  const nickname = typeof body.nickname === 'string'
    ? body.nickname.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ')
    : null;
  if (nickname === null) return json(400, { error: 'missing', message: 'Enter a nickname.' });
  if ([...nickname].length > NICKNAME_MAX) return json(400, { error: 'too_long', message: `Keep it to ${NICKNAME_MAX} characters.` });
  await sql(`INSERT INTO user_profile (user_id, nickname) VALUES ($1, $2)
             ON CONFLICT (user_id) DO UPDATE SET nickname = EXCLUDED.nickname, updated_at = now()`, [user.id, nickname]);
  return json(200, { user: await withProfile(user) });
}

async function signUp(body, ip) {
  const email = clean(body.email, 254).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  const name = clean(body.name, 80) || email.split('@')[0];
  if (!email || !password) return json(400, { error: 'missing', message: 'Enter your email and a password.' });
  if (password.length < 8) return json(400, { error: 'PASSWORD_TOO_SHORT', message: AUTH_MESSAGES.PASSWORD_TOO_SHORT });
  const r = await authCall('POST', '/sign-up/email', { body: { email, password, name }, ip });
  if (!r.ok) return authError(r);
  const session = r.cookies[SESSION_COOKIE];
  if (!session) return json(200, { session: null, message: 'Account created. Check your email to confirm it, then sign in.' });
  return signedIn(session, ip);
}

async function signInEmail(body, ip) {
  const email = clean(body.email, 254).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !password) return json(400, { error: 'missing', message: 'Enter your email and password.' });
  const r = await authCall('POST', '/sign-in/email', { body: { email, password }, ip });
  if (!r.ok) return authError(r);
  const session = r.cookies[SESSION_COOKIE];
  if (!session) return json(400, { error: 'not_verified', message: 'Confirm your email first (check your inbox), then sign in.' });
  return signedIn(session, ip);
}

// Google: step 1 gives the app the page to open and a "challenge" to bring back with the code.
// For the phone app (return address with app=1) there's also a "handoff": a one-time id added to
// the return address. The website's return page leaves the code here under that id, and the app
// collects the session with it (/auth/google/claim), so sign-in finishes even when Android doesn't
// pass the return link to the app, or restarts the app meanwhile.
async function startGoogle(body, ip) {
  let callbackURL = typeof body.callbackURL === 'string' ? body.callbackURL : '';
  if (!CALLBACK_OK.test(callbackURL)) return json(400, { error: 'bad_callback', message: 'Not an allowed return address.' });
  const forApp = new URL(callbackURL).searchParams.get('app') === '1';
  const handoff = forApp ? randomUUID().replace(/-/g, '') : null;
  if (handoff) callbackURL += `${callbackURL.includes('?') ? '&' : '?'}h=${handoff}`;
  const r = await authCall('POST', '/sign-in/social', { body: { provider: 'google', callbackURL, disableRedirect: true }, ip });
  if (!r.ok || !r.data?.url) return authError(r);
  const challenge = Object.entries(r.cookies)
    .filter(([name, value]) => value && CHALLENGE_MARKERS.some((m) => name.endsWith(m)))
    .map(([name, value]) => `${name}=${value}`).join('; ');
  if (handoff) {
    await sql('DELETE FROM google_handoff WHERE created_at < now() - interval \'15 minutes\'');
    await sql('INSERT INTO google_handoff (id, challenge) VALUES ($1, $2)', [handoff, challenge]);
  }
  return json(200, { url: r.data.url, challenge, handoff });
}

const HANDOFF_ID = /^[0-9a-f]{32}$/;

// The website's return page (in the phone's browser tab) leaves Google's one-time code here.
async function googleHandoff(body) {
  const id = typeof body.handoff === 'string' && HANDOFF_ID.test(body.handoff) ? body.handoff : '';
  const verifier = clean(body.verifier, 500);
  if (!id || !verifier) return json(400, { error: 'missing', message: 'Missing sign-in details.' });
  await sql(`UPDATE google_handoff SET verifier = $2
             WHERE id = $1 AND verifier IS NULL AND created_at > now() - interval '15 minutes'`, [id, verifier]);
  return json(200, { ok: true });
}

// The app collects its Google sign-in: { session, user } when it's done, { pending: true } while
// the person is still on Google. The code comes from the return page (googleHandoff) or from the
// app itself when Android did pass it the return link. Asking again after success gives the same
// session for a few minutes, in case the app restarted before saving it.
async function claimGoogle(body, ip) {
  const id = typeof body.handoff === 'string' && HANDOFF_ID.test(body.handoff) ? body.handoff : '';
  if (!id) return json(400, { error: 'missing', message: 'Sign-in didn\'t finish. Try again.' });
  const rows = await sql(`SELECT challenge, verifier, session FROM google_handoff
                          WHERE id = $1 AND created_at > now() - interval '15 minutes'`, [id]);
  const row = rows[0];
  if (!row) return json(404, { error: 'expired', message: 'Google sign-in took too long. Try again.' });
  if (row.session) return signedIn(row.session, ip);
  const verifier = clean(body.verifier, 500) || row.verifier;
  if (!verifier) return json(200, { pending: true });
  const r = await authCall('GET', '/get-session', { query: { neon_auth_session_verifier: verifier }, cookie: row.challenge || undefined, ip });
  const session = r.cookies[SESSION_COOKIE];
  if (!r.ok || !session) {
    // The code works once: the app and the return page may both have sent it at the same moment.
    await new Promise((r2) => setTimeout(r2, 1500)); // let the other request save the session
    const again = await sql('SELECT session FROM google_handoff WHERE id = $1', [id]);
    if (again[0]?.session) return signedIn(again[0].session, ip);
    return json(400, { error: 'google_failed', message: 'Google sign-in didn\'t finish. Try again.' });
  }
  await sql('UPDATE google_handoff SET session = $2, verifier = NULL, challenge = NULL WHERE id = $1', [id, session]);
  return signedIn(session, ip);
}

// Google: step 2, the one-time code from the return address -> a session.
async function finishGoogle(body, ip) {
  const verifier = clean(body.verifier, 500);
  const challenge = typeof body.challenge === 'string' ? body.challenge.slice(0, 2000) : '';
  if (!verifier) return json(400, { error: 'missing', message: 'Sign-in didn\'t finish. Try again.' });
  const r = await authCall('GET', '/get-session', { query: { neon_auth_session_verifier: verifier }, cookie: challenge || undefined, ip });
  const session = r.cookies[SESSION_COOKIE];
  if (!r.ok || !session) return json(400, { error: 'google_failed', message: 'Google sign-in didn\'t finish. Try again.' });
  return signedIn(session, ip);
}

// Forgot password: Neon Auth emails a 6-digit code (Email OTP), typed into the app with a new password.
async function forgotPassword(body, ip) {
  const email = clean(body.email, 254).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'INVALID_EMAIL', message: AUTH_MESSAGES.INVALID_EMAIL });
  const r = await authCall('POST', '/forget-password/email-otp', { body: { email }, ip });
  if (!r.ok && r.status === 429) return authError(r);
  // Same answer either way, so nobody can find out which emails have an account.
  return json(200, { ok: true });
}

async function resetPassword(body, ip) {
  const email = clean(body.email, 254).toLowerCase();
  const code = clean(body.code, 20).replace(/\s+/g, '');
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email || !code) return json(400, { error: 'missing', message: 'Enter the code from the email.' });
  if (password.length < 8) return json(400, { error: 'PASSWORD_TOO_SHORT', message: AUTH_MESSAGES.PASSWORD_TOO_SHORT });
  const r = await authCall('POST', '/email-otp/reset-password', { body: { email, otp: code, password }, ip });
  if (!r.ok) return authError(r);
  // Signed in straight away with the new password.
  return signInEmail({ email, password }, ip);
}

async function checkSession(body, ip) {
  const session = typeof body.session === 'string' ? body.session : '';
  sessionCache.delete(session);
  const user = await userForSession(session, ip);
  return user ? json(200, { user: await withProfile(user) }) : json(401, { error: 'signed_out', message: 'Please sign in again.' });
}

async function signOut(body, ip) {
  const session = typeof body.session === 'string' ? body.session : '';
  if (session) {
    sessionCache.delete(session);
    await authCall('POST', '/sign-out', { body: {}, cookie: `${SESSION_COOKIE}=${session}`, ip }).catch(() => {});
  }
  return json(200, { ok: true });
}

// ---------- the listener's library, synced between devices ----------
// One document per account:
//   liked:     [track + { at }]                    newest first
//   playlists: [{ id, title, createdAt, updatedAt, tracks }]
//   recent:    [track + { at }]                    newest first, 30
//   removed:   { likes: { id: at }, playlists: { id: at } }   so deletions win over older copies
//   stats:     { devices: { [deviceId]: { months, meta, at } } }  each device's own counts
// A device sends its whole state; the server merges (newest wins) and returns the result, plus the
// other devices' stats added together.

const MAX_LIBRARY_BYTES = 3 * 1024 * 1024;
const TOMBSTONE_DAYS = 180;

const arr = (v) => (Array.isArray(v) ? v : []);
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

function newestById(lists, stamp) {
  const m = new Map();
  for (const item of lists.flat()) {
    if (!item || typeof item.id !== 'string') continue;
    const prev = m.get(item.id);
    if (!prev || num(item[stamp]) > num(prev[stamp])) m.set(item.id, item);
  }
  return [...m.values()];
}

function mergeStamps(a, b) {
  const out = { ...obj(a) };
  const cutoff = Date.now() - TOMBSTONE_DAYS * 86400000;
  for (const [k, v] of Object.entries(obj(b))) if (num(v) > num(out[k])) out[k] = num(v);
  for (const [k, v] of Object.entries(out)) if (num(v) < cutoff) delete out[k];
  return out;
}

function mergeLibrary(stored, incoming, deviceId) {
  const removed = {
    likes: mergeStamps(stored.removed?.likes, incoming.removed?.likes),
    playlists: mergeStamps(stored.removed?.playlists, incoming.removed?.playlists),
  };
  const liked = newestById([arr(stored.liked), arr(incoming.liked)], 'at')
    .filter((t) => !(num(removed.likes[t.id]) >= num(t.at)))
    .sort((a, b) => num(b.at) - num(a.at)).slice(0, 5000);
  const playlists = newestById([arr(stored.playlists), arr(incoming.playlists)], 'updatedAt')
    .filter((p) => !(num(removed.playlists[p.id]) >= num(p.updatedAt)))
    .map((p) => ({ ...p, tracks: arr(p.tracks).slice(0, 3000) }))
    .sort((a, b) => num(b.createdAt) - num(a.createdAt)).slice(0, 500);
  const recent = newestById([arr(stored.recent), arr(incoming.recent)], 'at')
    .sort((a, b) => num(b.at) - num(a.at)).slice(0, 30);
  const devices = { ...obj(obj(stored.stats).devices) };
  if (deviceId && incoming.stats) {
    devices[deviceId] = { months: obj(incoming.stats.months), meta: obj(incoming.stats.meta), at: Date.now() };
    const ids = Object.keys(devices).sort((a, b) => num(devices[b].at) - num(devices[a].at));
    for (const id of ids.slice(20)) delete devices[id]; // keep the 20 most recent devices
  }
  return { liked, playlists, recent, removed, stats: { devices } };
}

// Every device's stats except `deviceId`, added together.
function otherStats(devices, deviceId) {
  const months = {};
  const meta = {};
  for (const [id, d] of Object.entries(obj(devices))) {
    if (id === deviceId) continue;
    Object.assign(meta, obj(d.meta));
    for (const [k, m] of Object.entries(obj(d.months))) {
      const t = (months[k] ||= { s: 0, n: 0, songs: {} });
      t.s += num(m.s);
      t.n += num(m.n);
      for (const [song, row] of Object.entries(obj(m.songs))) {
        const r = (t.songs[song] ||= [0, 0]);
        r[0] += num(row?.[0]);
        r[1] += num(row?.[1]);
      }
    }
  }
  return { months, meta };
}

// ---------- profiles (like Netflix: up to 6 per account, each with its own library) ----------
// The first profile is "main": it holds the account's library from before profiles. It's created
// on first use, named after the nickname or first name, and can't be deleted.
const MAIN_PROFILE = 'main';
const MAX_PROFILES = 6;
const PROFILE_NAME_MAX = 20;
const AVATAR_ID = /^[a-z0-9-]{1,20}$/;

async function listProfiles(user) {
  let rows = await sql('SELECT id, name, avatar FROM account_profiles WHERE user_id = $1 ORDER BY position, created_at', [user.id]);
  if (!rows.some((r) => r.id === MAIN_PROFILE)) {
    const [nick] = await sql('SELECT nickname FROM user_profile WHERE user_id = $1', [user.id]).catch(() => []);
    const name = (nick?.nickname || (user.name || '').trim().split(/\s+/)[0] || 'Me').slice(0, PROFILE_NAME_MAX);
    await sql(`INSERT INTO account_profiles (user_id, id, name, avatar, position) VALUES ($1, $2, $3, $4, 0)
               ON CONFLICT (user_id, id) DO NOTHING`, [user.id, MAIN_PROFILE, name, user.image ? 'google' : 'headphones']);
    rows = await sql('SELECT id, name, avatar FROM account_profiles WHERE user_id = $1 ORDER BY position, created_at', [user.id]);
  }
  return rows.map((r) => ({ id: r.id, name: r.name, avatar: r.avatar, main: r.id === MAIN_PROFILE }));
}

const profilesReply = async (user) => json(200, { profiles: await listProfiles(user) });

function profileFields(body) {
  const name = typeof body.name === 'string' ? body.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ') : '';
  if (!name) return { error: json(400, { error: 'missing', message: 'Give the profile a name.' }) };
  if ([...name].length > PROFILE_NAME_MAX) return { error: json(400, { error: 'too_long', message: `Keep the name to ${PROFILE_NAME_MAX} characters.` }) };
  const avatar = typeof body.avatar === 'string' && AVATAR_ID.test(body.avatar) ? body.avatar : 'headphones';
  return { name, avatar };
}

// Create (no id) or change a profile's name and avatar.
async function saveProfile(body, user) {
  const f = profileFields(body);
  if (f.error) return f.error;
  const existing = await listProfiles(user);
  const id = clean(body.id, 40);
  if (id) {
    if (!existing.some((p) => p.id === id)) return json(404, { error: 'no_profile', message: 'This profile was deleted.' });
    await sql('UPDATE account_profiles SET name = $3, avatar = $4 WHERE user_id = $1 AND id = $2', [user.id, id, f.name, f.avatar]);
  } else {
    if (existing.length >= MAX_PROFILES) return json(400, { error: 'too_many', message: `An account can have up to ${MAX_PROFILES} profiles.` });
    await sql(`INSERT INTO account_profiles (user_id, id, name, avatar, position) VALUES ($1, $2, $3, $4,
               (SELECT COALESCE(MAX(position), 0) + 1 FROM account_profiles WHERE user_id = $1))`,
    [user.id, `p-${randomUUID().slice(0, 8)}`, f.name, f.avatar]);
  }
  return profilesReply(user);
}

async function deleteProfile(body, user) {
  const id = clean(body.id, 40);
  if (id === MAIN_PROFILE) return json(400, { error: 'main_profile', message: 'The main profile can\'t be deleted.' });
  await sql('DELETE FROM account_profiles WHERE user_id = $1 AND id = $2', [user.id, id]);
  await sql('DELETE FROM user_library WHERE user_id = $1 AND profile_id = $2', [user.id, id]);
  return profilesReply(user);
}

const libraryReply = (doc, deviceId) => json(200, {
  liked: doc.liked || [], playlists: doc.playlists || [], recent: doc.recent || [], removed: doc.removed || { likes: {}, playlists: {} },
  statsOthers: otherStats(doc.stats?.devices, deviceId),
});

async function syncLibrary(request, user) {
  const text = await request.text();
  if (text.length > MAX_LIBRARY_BYTES) return json(413, { error: 'too_big', message: 'Your library is too big to sync.' });
  let body;
  try { body = JSON.parse(text); } catch (e) { return json(400, { error: 'bad_json' }); }
  const deviceId = clean(body.deviceId, 60);
  // Each profile has its own library; apps from before profiles sync the main one.
  const profileId = clean(body.profileId, 40) || MAIN_PROFILE;
  if (profileId !== MAIN_PROFILE) {
    const found = await sql('SELECT 1 FROM account_profiles WHERE user_id = $1 AND id = $2', [user.id, profileId]);
    if (!found.length) return json(404, { error: 'no_profile', message: 'This profile was deleted.' });
  }
  // Two devices can sync at the same moment: save only if nobody saved in between, else merge again.
  for (let attempt = 0; attempt < 5; attempt++) {
    const [cur] = await sql('SELECT doc, version FROM user_library WHERE user_id = $1 AND profile_id = $2', [user.id, profileId]);
    const merged = mergeLibrary(cur?.doc || {}, obj(body), deviceId);
    const saved = cur
      ? await sql(`UPDATE user_library SET doc = $3::jsonb, version = version + 1, updated_at = now()
                   WHERE user_id = $1 AND profile_id = $2 AND version = $4 RETURNING version`, [user.id, profileId, JSON.stringify(merged), cur.version])
      : await sql(`INSERT INTO user_library (user_id, profile_id, doc, version) VALUES ($1, $2, $3::jsonb, 1)
                   ON CONFLICT (user_id, profile_id) DO NOTHING RETURNING version`, [user.id, profileId, JSON.stringify(merged)]);
    if (saved.length) return libraryReply(merged, deviceId);
  }
  return json(409, { error: 'busy', message: 'Sync is busy. It will try again.' });
}

// ---------- routing ----------

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type, x-admin-key, x-session',
  'access-control-max-age': '86400',
};

async function route(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
      if (request.method === 'GET' && (path === '/songs' || path === '/')) return await listSongs();
      if (request.method === 'POST' && path === '/plays') return await addPlay(await request.json());
      if (request.method === 'GET' && path === '/popular') return await popular(url);
      if (request.method === 'POST' && path === '/requests') return await addRequest(await request.json());

      // TEMPORARY: the phone app's sign-in steps (src/utils/diag.js), kept for a day.
      if (path === '/diag' && request.method === 'POST') {
        const b = obj(await request.json().catch(() => ({})));
        await sql('DELETE FROM client_diag WHERE at < now() - interval \'1 day\'');
        await sql('INSERT INTO client_diag (run, n, step, info) VALUES ($1, $2, $3, $4)',
          [clean(b.run, 20), Number(b.n) || 0, clean(b.step, 60), clean(b.info, 300)]);
        return json(200, { ok: true });
      }

      if (path.startsWith('/auth/') && request.method === 'POST') {
        const ip = clientIp(request);
        const body = obj(await request.json().catch(() => ({})));
        if (path === '/auth/sign-up') return await signUp(body, ip);
        if (path === '/auth/sign-in') return await signInEmail(body, ip);
        if (path === '/auth/google') return await startGoogle(body, ip);
        if (path === '/auth/google/finish') return await finishGoogle(body, ip);
        if (path === '/auth/google/handoff') return await googleHandoff(body);
        if (path === '/auth/google/claim') return await claimGoogle(body, ip);
        if (path === '/auth/session') return await checkSession(body, ip);
        if (path === '/auth/sign-out') return await signOut(body, ip);
        if (path === '/auth/forgot') return await forgotPassword(body, ip);
        if (path === '/auth/reset') return await resetPassword(body, ip);
      }

      if (path === '/me/library' && request.method === 'POST') {
        const user = await userForSession(request.headers.get('x-session'), clientIp(request));
        if (!user) return json(401, { error: 'signed_out', message: 'Please sign in again.' });
        return await syncLibrary(request, user);
      }

      if (path.startsWith('/me/profiles') && request.method === 'POST') {
        const user = await userForSession(request.headers.get('x-session'), clientIp(request));
        if (!user) return json(401, { error: 'signed_out', message: 'Please sign in again.' });
        const b = obj(await request.json().catch(() => ({})));
        if (path === '/me/profiles') return await profilesReply(user);
        if (path === '/me/profiles/save') return await saveProfile(b, user);
        if (path === '/me/profiles/delete') return await deleteProfile(b, user);
      }

      if (path === '/me/profile' && request.method === 'POST') {
        const user = await userForSession(request.headers.get('x-session'), clientIp(request));
        if (!user) return json(401, { error: 'signed_out', message: 'Please sign in again.' });
        return await updateProfile(obj(await request.json().catch(() => ({}))), user);
      }

      if (path.startsWith('/admin/')) {
        if (!isAdmin(request)) {
          await new Promise((r) => setTimeout(r, 800)); // slow down password guessing
          return json(401, { error: 'unauthorized', message: 'Wrong admin password.' });
        }
        if (request.method === 'POST' && path === '/admin/verify') return json(200, { ok: true });
        if (request.method === 'POST' && path === '/admin/prepare') return await prepare(await request.json());
        if (request.method === 'POST' && path === '/admin/songs') return await saveSong(await request.json());
        if (request.method === 'GET' && path === '/admin/storage') return await storageStatus();
        if (request.method === 'GET' && path === '/admin/requests') return await listRequests();
        const rq = path.match(/^\/admin\/requests\/([^/]+)$/);
        if (request.method === 'PATCH' && rq) return await updateRequest(rq[1], await request.json());
        if (request.method === 'DELETE' && rq) return await removeRequest(rq[1]);
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
