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

// ---------- FLAC (Vorbis comments + PICTURE block) ----------

const le32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const VORBIS = { TITLE: 'TIT2', ARTIST: 'TPE1', ALBUMARTIST: 'TPE2', ALBUM: 'TALB', GENRE: 'TCON', DATE: 'TDRC', YEAR: 'TYER' };

function vorbisComments(b, frames) {
  let i = 4 + le32(b, 0); // skip the vendor string
  const count = le32(b, i);
  i += 4;
  for (let n = 0; n < count && i + 4 <= b.length; n += 1) {
    const len = le32(b, i);
    const text = utf8(b.subarray(i + 4, i + 4 + len));
    i += 4 + len;
    const eq = text.indexOf('=');
    const id = VORBIS[text.slice(0, eq).toUpperCase()];
    if (!id) continue;
    const value = text.slice(eq + 1).trim();
    frames[id] = frames[id] ? `${frames[id]}, ${value}` : value; // several ARTIST= lines
  }
}

function flacPicture(b) {
  let i = 0;
  const type = be32(b, i); i += 4;
  const mimeLen = be32(b, i); i += 4;
  const mime = latin1(b.subarray(i, i + mimeLen)).toLowerCase() || 'image/jpeg'; i += mimeLen;
  i += 4 + be32(b, i); // description
  i += 16; // width, height, depth, colours
  const len = be32(b, i); i += 4;
  return { type, mime, data: b.subarray(i, i + len) };
}

// ---------- M4A / MP4 (iTunes "ilst" atoms) ----------

const MP4 = { '\xa9nam': 'TIT2', '\xa9ART': 'TPE1', aART: 'TPE2', '\xa9alb': 'TALB', '\xa9gen': 'TCON', '\xa9day': 'TDRC' };

// The boxes inside `b` (each: 4-byte size, 4-letter type, contents).
function* boxes(b) {
  for (let i = 0; i + 8 <= b.length;) {
    const len = be32(b, i);
    if (len < 8 || i + len > b.length) return;
    yield [latin1(b.subarray(i + 4, i + 8)), b.subarray(i + 8, i + len)];
    i += len;
  }
}
const child = (b, type) => { for (const [t, c] of boxes(b)) if (t === type) return c; return null; };

export function parseMoov(moov) {
  const meta = child(child(moov, 'udta') || new Uint8Array(0), 'meta');
  const ilst = meta && child(meta.subarray(4), 'ilst'); // "meta" has 4 bytes of version/flags first
  if (!ilst) return null;
  const frames = {};
  for (const [type, item] of boxes(ilst)) {
    const data = child(item, 'data');
    if (!data || data.length < 8) continue;
    const kind = be32(data, 0) & 0xffffff;
    const payload = data.subarray(8); // after type and locale
    if (type === 'covr' && !frames.APIC) {
      frames.APIC = { type: 3, mime: kind === 14 ? 'image/png' : 'image/jpeg', data: payload };
    } else if (MP4[type] && kind === 1) {
      frames[MP4[type]] = utf8(payload);
    }
  }
  return frames;
}

// ---------- reading the file ----------

const MAX_MOOV_BYTES = 16 * 1024 * 1024;

// Raw frames ({ TIT2, TPE1, TALB, TCON, TDRC, APIC }) from an MP3, FLAC or M4A file, reading only
// the tag part, never the whole song. null if the file has no tags we understand.
async function readFrames(uri) {
  const h = new File(uri).open(FileMode.ReadOnly);
  try {
    const head = await h.readBytes(12);
    if (head.length < 12) return null;
    const tag = latin1(head.subarray(0, 4));

    if (tag.startsWith('ID3')) {
      const size = syncsafe(head, 6);
      if (size <= 0 || size > MAX_TAG_BYTES) return null;
      h.offset = 10;
      const rest = await h.readBytes(size);
      const bytes = new Uint8Array(10 + rest.length);
      bytes.set(head.subarray(0, 10), 0);
      bytes.set(rest, 10);
      return parseID3(bytes);
    }

    if (tag === 'fLaC') {
      const frames = {};
      let pos = 4;
      for (let n = 0; n < 128; n += 1) {
        h.offset = pos;
        const bh = await h.readBytes(4);
        if (bh.length < 4) break;
        const type = bh[0] & 0x7f;
        const len = (bh[1] << 16) | (bh[2] << 8) | bh[3];
        if ((type === 4 || type === 6) && len <= MAX_TAG_BYTES) {
          const block = await h.readBytes(len);
          if (type === 4) vorbisComments(block, frames);
          else {
            const pic = flacPicture(block);
            if (!frames.APIC || (pic.type === 3 && frames.APIC.type !== 3)) frames.APIC = pic; // front cover first
          }
        }
        pos += 4 + len;
        if (bh[0] & 0x80) break; // last metadata block
      }
      return Object.keys(frames).length ? frames : null;
    }

    if (latin1(head.subarray(4, 8)) === 'ftyp') {
      // Find "moov" among the top-level boxes (it can come after the audio, so skip over boxes).
      const size = h.size || 0;
      for (let pos = 0; pos + 8 <= size;) {
        h.offset = pos;
        const bh = await h.readBytes(16);
        if (bh.length < 8) break;
        let len = be32(bh, 0);
        let hdr = 8;
        if (len === 1) { len = be32(bh, 8) * 2 ** 32 + be32(bh, 12); hdr = 16; } else if (len === 0) len = size - pos;
        if (len < hdr) break;
        if (latin1(bh.subarray(4, 8)) === 'moov') {
          if (len > MAX_MOOV_BYTES) return null;
          h.offset = pos + hdr;
          return parseMoov(await h.readBytes(len - hdr));
        }
        pos += len;
      }
    }
    return null;
  } finally {
    h.close();
  }
}

/**
 * Read the tags of an audio file on the phone (MP3, FLAC or M4A). Returns null if it has none.
 * The cover, if any, is saved to the cache so the upload form can use it like a picked image
 * (unless `cover: false`: songs on the phone are listed without saving anything).
 */
export async function readTags(uri, { cover: withCover = true } = {}) {
  const details = tagsToDetails(await readFrames(uri));
  if (!details) return null;
  if (withCover && details.picture) {
    const ext = details.picture.mime.includes('png') ? 'png' : 'jpg';
    const cover = new File(Paths.cache, `tag-cover-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`);
    cover.create({ overwrite: true });
    cover.write(details.picture.data);
    details.cover = { uri: cover.uri, name: `cover.${ext}`, mimeType: details.picture.mime };
  }
  delete details.picture;
  return details;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(b) {
  let out = '';
  for (let i = 0; i < b.length; i += 3) {
    const n = (b[i] << 16) | ((b[i + 1] || 0) << 8) | (b[i + 2] || 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]
      + (i + 1 < b.length ? B64[(n >> 6) & 63] : '=') + (i + 2 < b.length ? B64[n & 63] : '=');
  }
  return out;
}

const MAX_COVER_BYTES = 1.5 * 1024 * 1024;

// The cover picture inside an MP3, FLAC or M4A: { mime, data } or null.
export async function readCover(uri) {
  const pic = (await readFrames(uri))?.APIC;
  if (!pic?.data || pic.data.length < 100 || pic.data.length > MAX_COVER_BYTES) return null;
  return { mime: pic.mime, data: pic.data };
}

/** The cover as a data: URI kept in memory (nothing is written to the phone). null if none. */
export async function readCoverDataUri(uri) {
  const pic = await readCover(uri);
  return pic && `data:${pic.mime};base64,${base64(pic.data)}`;
}
