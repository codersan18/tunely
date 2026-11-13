#!/usr/bin/env node
// Compresses songs in the VibeRoom library so more of them fit in storage and they stream with less data.
//
//   ADMIN_KEY=... node scripts/optimize-songs.mjs            (needs ffmpeg on PATH, or FFMPEG=/path/to/ffmpeg)
//
// For every song not yet processed:
//   - audio above 160 kbps is re-encoded to AAC 128 kbps (.m4a), which sounds the same on phones and
//     earphones but is ~60% smaller than a 320 kbps MP3
//   - if the song has no cover yet, the cover embedded in the file (if any) becomes its cover
//   - the song length is filled in
// The original file is deleted once the compressed one is live. Runs from .github/workflows/optimize.yml.

import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const API = process.env.API_URL || 'https://br-polished-mud-azcthrf7-api.compute.c-3.ap-southeast-1.aws.neon.tech';
const KEY = process.env.ADMIN_KEY;
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const TARGET_KBPS = 128;
const COMPRESS_ABOVE_KBPS = 160; // leave files that are already small alone
const MIN_SAVING = 0.15;         // only switch if the new file is at least 15% smaller

if (!KEY) { console.error('Set ADMIN_KEY.'); process.exit(1); }

async function api(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'x-admin-key': KEY, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${data.message || data.error || ''}`);
  return data;
}

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', ...args]);
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => resolve({ code, err }));
  });
}

// Read duration, audio codec/bitrate and whether there's an embedded cover from ffmpeg's file summary.
async function probe(file) {
  const { err } = await ffmpeg(['-i', file]);
  const d = err.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = d ? (+d[1]) * 3600 + (+d[2]) * 60 + (+d[3]) : null;
  const audioLine = err.split('\n').find((l) => /Stream #.*Audio: /.test(l)) || '';
  const codec = audioLine.match(/Audio: (\w+)/)?.[1] || null;
  const streamKbps = audioLine.match(/(\d+) kb\/s/)?.[1];
  const total = err.match(/Duration:[^\n]*bitrate: (\d+) kb\/s/);
  const cover = err.match(/Stream #\S+.*?Video: (mjpeg|png)/);
  return {
    duration,
    codec,
    kbps: Number(streamKbps || total?.[1] || 0),
    cover: cover ? (cover[1] === 'png' ? 'png' : 'jpg') : null,
  };
}

async function put(url, file, type) {
  const res = await fetch(url, { method: 'PUT', body: await readFile(file), headers: { 'content-type': type } });
  if (!res.ok) throw new Error(`upload failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;

async function optimize(song, dir) {
  const src = join(dir, 'in');
  const res = await fetch(song.url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  await writeFile(src, Buffer.from(await res.arrayBuffer()));
  const before = (await stat(src)).size;
  const info = await probe(src);

  const plan = { ext: null, artworkExt: null };
  let out = null;
  if (info.kbps > COMPRESS_ABOVE_KBPS || !['mp3', 'aac', 'opus', 'vorbis'].includes(info.codec)) {
    out = join(dir, 'out.m4a');
    const r = await ffmpeg(['-y', '-i', src, '-map', '0:a:0', '-vn', '-c:a', 'aac', '-b:a', `${TARGET_KBPS}k`,
      '-ac', '2', '-ar', '44100', '-movflags', '+faststart', out]);
    if (r.code !== 0) throw new Error(`encode failed: ${r.err.slice(-300)}`);
    const after = (await stat(out)).size;
    if (after <= before * (1 - MIN_SAVING)) plan.ext = 'm4a';
    else out = null;
  }
  let art = null;
  if (!song.hasArtwork && info.cover) {
    art = join(dir, `cover.${info.cover}`);
    const r = await ffmpeg(['-y', '-i', src, '-an', '-map', '0:v:0', '-c:v', 'copy', '-frames:v', '1', art]);
    if (r.code === 0 && (await stat(art)).size < 2e6) plan.artworkExt = info.cover;
    else art = null;
  }

  const prep = (plan.ext || plan.artworkExt) ? await api('POST', `/admin/optimize/${song.id}/prepare`, plan) : {};
  if (prep.audioUploadUrl) await put(prep.audioUploadUrl, out, 'audio/mp4');
  if (prep.artworkUploadUrl) await put(prep.artworkUploadUrl, art, info.cover === 'png' ? 'image/png' : 'image/jpeg');
  const done = await api('POST', `/admin/optimize/${song.id}/done`, {
    audioKey: prep.audioKey, artworkKey: prep.artworkKey, duration: info.duration,
  });
  const note = [
    plan.ext ? `${mb(before)} -> ${mb(done.after)} (${info.kbps} kbps ${info.codec} -> ${TARGET_KBPS} kbps aac)` : `kept ${mb(before)} (${info.kbps} kbps ${info.codec})`,
    prep.artworkKey ? 'cover added' : null,
    info.duration ? `${Math.round(info.duration)}s` : null,
  ].filter(Boolean).join(', ');
  console.log(`  ${song.title}: ${note}`);
  return { before, after: done.after || before };
}

// The server hands out 20 songs at a time. Keep asking until nothing is left, so songs uploaded
// while this runs are picked up too. Songs that fail are skipped until the next run.
let saved = 0;
let failed = 0;
let done = 0;
const skip = new Set();
for (;;) {
  const { songs } = await api('GET', '/admin/optimize/pending');
  const todo = songs.filter((s) => !skip.has(s.id));
  if (!todo.length) break;
  console.log(`${todo.length} song(s) to process`);
  for (const song of todo) {
    const dir = await mkdtemp(join(tmpdir(), 'vr-'));
    try {
      const r = await optimize(song, dir);
      saved += r.before - r.after;
      done += 1;
    } catch (e) {
      failed += 1;
      skip.add(song.id);
      console.error(`  ${song.title}: FAILED - ${e.message}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  if (todo.length === songs.length && songs.length < 20) break; // that was the last batch
}
console.log(`Compressed ${done} song(s), saved ${mb(saved)}.${failed ? ` ${failed} failed (will retry next run).` : ''}`);
process.exit(failed ? 1 : 0);
