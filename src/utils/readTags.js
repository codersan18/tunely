// Reads the details stored inside an MP3 (ID3v2.2 / 2.3 / 2.4 tags): title, artists, album, genre,
// year and the cover picture. Used by the upload screen to fill in the form for you.
// Plain JavaScript, so it works in the app as-is (no native code).

import { File, FileMode, Paths } from 'expo-file-system';
import { LANGUAGES, MOODS } from './smartShuffle';

const MAX_TAG_BYTES = 4 * 1024 * 1024; // tags (with cover) are rarely over a few hundred KB

// ---------- text decoding (no TextDecoder needed) ----------

function latin1(b) {
  let s = '';
  for (let i = 0; i < b.length; i += 1) s += String.fromCharCode(b[i]);
  return s;
}

function utf8(b) {
  let s = '';
  for (let i = 0; i < b.length;) {
    const c = b[i];
    let cp;
    if (c < 0x80) { cp = c; i += 1; }
    else if (c >= 0xc0 && c < 0xe0) { cp = ((c & 0x1f) << 6) | (b[i + 1] & 0x3f); i += 2; }
    else if (c >= 0xe0 && c < 0xf0) { cp = ((c & 0x0f) << 12) | ((b[i + 1] & 0x3f) << 6) | (b[i + 2] & 0x3f); i += 3; }
    else if (c >= 0xf0) { cp = ((c & 0x07) << 18) | ((b[i + 1] & 0x3f) << 12) | ((b[i + 2] & 0x3f) << 6) | (b[i + 3] & 0x3f); i += 4; }
    else { i += 1; continue; }
    s += String.fromCodePoint(cp);
  }
  return s;
}

function utf16(b, bigEndian) {
  let s = '';
  let i = 0;
  let be = bigEndian;
  if (b[0] === 0xfe && b[1] === 0xff) { be = true; i = 2; }
  else if (b[0] === 0xff && b[1] === 0xfe) { be = false; i = 2; }
  for (; i + 1 < b.length; i += 2) s += String.fromCharCode(be ? (b[i] << 8) | b[i + 1] : b[i] | (b[i + 1] << 8));
  return s;
}

const decode = (enc, b) => (enc === 1 ? utf16(b, false) : enc === 2 ? utf16(b, true) : enc === 3 ? utf8(b) : latin1(b));

// Where a null-terminated string ends (UTF-16 uses a double null on an even boundary).
function nullEnd(b, start, enc) {
  if (enc === 1 || enc === 2) {
    for (let i = start; i + 1 < b.length; i += 2) if (b[i] === 0 && b[i + 1] === 0) return i;
    return b.length;
  }
  for (let i = start; i < b.length; i += 1) if (b[i] === 0) return i;
  return b.length;
}

// Text frames: "\0" separates multiple values in v2.4.
function textFrame(b) {
  if (!b.length) return '';
  return decode(b[0], b.subarray(1)).split('\0').map((x) => x.trim()).filter(Boolean).join(', ');
}

function pictureFrame(b, v2) {
  const enc = b[0];
  let i = 1;
  let mime;
  if (v2) { // ID3v2.2 "PIC": 3-letter format
    mime = latin1(b.subarray(1, 4)).toLowerCase() === 'png' ? 'image/png' : 'image/jpeg';
    i = 4;
  } else {
    const end = nullEnd(b, 1, 0);
    mime = latin1(b.subarray(1, end)).toLowerCase() || 'image/jpeg';
    if (!mime.includes('/')) mime = mime.includes('png') ? 'image/png' : 'image/jpeg';
    i = end + 1;
  }
  const type = b[i];
  i += 1;
  i = nullEnd(b, i, enc) + (enc === 1 || enc === 2 ? 2 : 1); // skip description
  return { type, mime, data: b.subarray(i) };
}

const syncsafe = (b, o) => ((b[o] & 0x7f) << 21) | ((b[o + 1] & 0x7f) << 14) | ((b[o + 2] & 0x7f) << 7) | (b[o + 3] & 0x7f);
const be32 = (b, o) => ((b[o] << 24) >>> 0) + (b[o + 1] << 16) + (b[o + 2] << 8) + b[o + 3];

// Undo "unsynchronisation" (0xFF 0x00 -> 0xFF).
function unsync(b) {
  const out = new Uint8Array(b.length);
  let n = 0;
  for (let i = 0; i < b.length; i += 1) {
    out[n++] = b[i];
    if (b[i] === 0xff && b[i + 1] === 0x00) i += 1;
  }
  return out.subarray(0, n);
}

/** Parse ID3v2 tag bytes (starting with "ID3"). Returns raw frames: { TIT2: '...', APIC: {...}, ... }. */
export function parseID3(bytes) {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null;
  const ver = bytes[3];
  if (ver < 2 || ver > 4) return null;
  const flags = bytes[5];
  const size = syncsafe(bytes, 6);
  let tag = bytes.subarray(10, 10 + size);
  if (ver < 4 && flags & 0x80) tag = unsync(tag);
  let pos = 0;
  if (flags & 0x40 && ver >= 3) pos = ver === 4 ? syncsafe(tag, 0) : be32(tag, 0) + 4; // skip extended header

  const v2 = ver === 2;
  const idLen = v2 ? 3 : 4;
  const headLen = v2 ? 6 : 10;
  const frames = {};
  while (pos + headLen <= tag.length) {
    const id = latin1(tag.subarray(pos, pos + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break; // padding
    let fsize;
    if (v2) fsize = (tag[pos + 3] << 16) | (tag[pos + 4] << 8) | tag[pos + 5];
    else if (ver === 4) fsize = syncsafe(tag, pos + 4);
    else fsize = be32(tag, pos + 4);
    const fflags = v2 ? 0 : tag[pos + 9];
    let data = tag.subarray(pos + headLen, pos + headLen + fsize);
    pos += headLen + fsize;
    if (fsize <= 0) continue;
    if (ver === 4) {
      if (fflags & 0x01) data = data.subarray(4); // data length indicator
      if (fflags & 0x02) data = unsync(data);
    }
    try {
      if (id === 'APIC' || id === 'PIC') {
        const pic = pictureFrame(data, v2);
        // Prefer the front cover; otherwise keep the first picture.
        if (!frames.APIC || (pic.type === 3 && frames.APIC.type !== 3)) frames.APIC = pic;
      } else if (id[0] === 'T' && id !== 'TXXX' && id !== 'TXX') {
        const key = { TT2: 'TIT2', TP1: 'TPE1', TP2: 'TPE2', TAL: 'TALB', TCO: 'TCON', TYE: 'TYER', TCM: 'TCOM' }[id] || id;
        if (!frames[key]) frames[key] = textFrame(data);
      }
    } catch (e) {
      // Skip a broken frame, keep the rest.
    }
  }
  return frames;
}

// ---------- turning raw tags into form values ----------

// Download-site names that get stuffed into tags, e.g. "Song [Masstamilan.io]" or "www.site.com".
const TLD = '(?:com|in|io|net|org|co|xyz|fm|cc|info|me|site|mobi|pw|cool|link|live|top|club|biz|to|ws|dev|app|vip)';
const SITE_IN_BRACKETS = new RegExp(`\\s*[[(][^\\])]*\\b[a-z0-9-]+\\.${TLD}\\b[^\\])]*[\\])]`, 'gi');
const SITE_BARE = new RegExp(`\\s*(?:www\\.)?\\b[a-z0-9-]+\\.${TLD}\\b(?:\\.${TLD}\\b)?`, 'gi');
const clean = (s = '') => s.replace(SITE_IN_BRACKETS, '').replace(SITE_BARE, '')
  .replace(/^\s*[-|:]\s*/, '').replace(/\s*[-|:]\s*$/, '').replace(/\s+/g, ' ').trim();

// Genre "(13)" style references -> keep any text after them.
const cleanGenre = (s = '') => clean(s.replace(/^\(\d+\)/, ''));

const INDUSTRY = { kollywood: 'Tamil', tollywood: 'Telugu', mollywood: 'Malayalam', sandalwood: 'Kannada', bollywood: 'Hindi' };

function guessLanguage(...texts) {
  const hay = texts.filter(Boolean).join(' ').toLowerCase();
  for (const lang of LANGUAGES) if (hay.includes(lang.toLowerCase())) return lang;
  for (const [word, lang] of Object.entries(INDUSTRY)) if (hay.includes(word)) return lang;
  return '';
}

/** Raw frames -> { title, artist, album, genre, language, year, picture? } with junk removed. */
export function tagsToDetails(frames) {
  if (!frames) return null;
  const artist = clean(frames.TPE1 || frames.TPE2 || '').replace(/\s*[/;]\s*/g, ', ');
  const genreRaw = cleanGenre(frames.TCON || '');
  const language = guessLanguage(genreRaw, frames.TALB, frames.TIT2);
  // A genre that is just a language ("Tamil") goes to Language instead.
  const genre = genreRaw && genreRaw.toLowerCase() === language.toLowerCase() ? '' : genreRaw;
  const year = (frames.TDRC || frames.TYER || '').match(/\d{4}/)?.[0] || '';
  // A genre like "Melody" or "Devotional" is also a smart shuffle mood.
  const mood = MOODS.find((m) => genre.toLowerCase().split(/[\s,/&-]+/).includes(m.toLowerCase())) || '';
  const details = {
    title: clean(frames.TIT2 || ''),
    artist,
    album: clean(frames.TALB || ''),
    genre,
    language,
    mood,
    year,
  };
  if (frames.APIC?.data?.length > 100) details.picture = frames.APIC;
  return details;
}

/**
 * Read the tags of an audio file on the phone. Returns null if it has none (or isn't an MP3).
 * The cover, if any, is saved to the cache so the upload form can use it like a picked image.
 */
export async function readTags(uri) {
  const file = new File(uri);
  const handle = file.open(FileMode.ReadOnly);
  let bytes;
  try {
    const head = await handle.readBytes(10);
    if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return null;
    const size = syncsafe(head, 6);
    if (size <= 0 || size > MAX_TAG_BYTES) return null;
    const rest = await handle.readBytes(size);
    bytes = new Uint8Array(10 + rest.length);
    bytes.set(head, 0);
    bytes.set(rest, 10);
  } finally {
    handle.close();
  }

  const details = tagsToDetails(parseID3(bytes));
  if (!details) return null;
  if (details.picture) {
    const ext = details.picture.mime.includes('png') ? 'png' : 'jpg';
    const cover = new File(Paths.cache, `tag-cover-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`);
    cover.create({ overwrite: true });
    cover.write(details.picture.data);
    details.cover = { uri: cover.uri, name: `cover.${ext}`, mimeType: details.picture.mime };
  }
  delete details.picture;
  return details;
}
