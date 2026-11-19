# Tunely backend (Neon)

One Neon Function (`index.mjs`, slug `api`) plus a Postgres table and a storage bucket,
in the Neon project **tunely** (`round-pond-23269926`, branch `main` = `br-polished-mud-azcthrf7`, region Singapore).

- API: `https://br-polished-mud-azcthrf7-api.compute.c-3.ap-southeast-1.aws.neon.tech`
- Audio + covers: public bucket `songs` (`audio/<sha256>.<ext>`, `art/<sha256>.<ext>`)
- Song list: table `songs` in database `neondb`

## Endpoints

| Method | Path | Who | What |
|---|---|---|---|
| GET | `/songs` | anyone | all songs, newest first |
| POST | `/plays` | anyone | count a play `{ songId, device }` (once per device + song per 10 min) |
| GET | `/popular?days=7&limit=20` | anyone | most played songs lately `[{ id, plays }]` |
| POST | `/requests` | anyone | ask for a song `{ device, title, artist?, note? }` (5 a day per device) |
| POST | `/admin/verify` | admin | check the password |
| POST | `/admin/prepare` | admin | duplicate check, returns 15-minute upload URLs |
| POST | `/admin/songs` | admin | save the song once the file is uploaded |
| PATCH | `/admin/songs/:id` | admin | edit title, artist, album, genre, language, mood |
| DELETE | `/admin/songs/:id` | admin | remove a song and its files |
| GET | `/admin/storage` | admin | how full object storage is (uploads stop at 90%) |
| GET | `/admin/requests` | admin | song requests, open ones first |
| PATCH | `/admin/requests/:id` | admin | `{ done: true/false }` |
| DELETE | `/admin/requests/:id` | admin | remove a request |
| GET | `/admin/optimize/pending` | admin | songs not yet compressed |
| POST | `/admin/optimize/:id/prepare` | admin | upload URLs for the compressed file and embedded cover |
| POST | `/admin/optimize/:id/done` | admin | switch to the compressed file, delete the original |

Admin calls send the password in the `x-admin-key` header. It is stored only as the function's
`ADMIN_KEY` environment variable, never in the app.

## Duplicates

A song is rejected if the **same audio file** (SHA-256) or the **same title + artist**
(ignoring case and extra spaces) already exists. The app checks first, and the database enforces both
with unique constraints, so two uploads at the same moment can't both get in.

## Deploy a change

The function has no dependencies, so the zip only needs `index.mjs`:

```bash
zip -j function.zip backend/index.mjs
neon functions deploy api --src backend/index.mjs --project-id round-pond-23269926
```

## Change the admin password

```bash
neon functions deploy api --src backend/index.mjs --project-id round-pond-23269926 --env ADMIN_KEY=<new password>
```

Then tap **Lock** in the app's Manage songs screen and unlock with the new password.

## Table

```sql
CREATE TABLE songs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL, artist text NOT NULL DEFAULT 'Unknown artist',
  album text, genre text, language text, mood text, duration integer,
  optimized boolean NOT NULL DEFAULT false, original_size bigint,
  audio_key text NOT NULL, artwork_key text,
  content_hash text NOT NULL, size_bytes bigint,
  title_key text GENERATED ALWAYS AS (lower(regexp_replace(trim(title), '\s+', ' ', 'g'))) STORED,
  artist_key text GENERATED ALWAYS AS (lower(regexp_replace(trim(artist), '\s+', ' ', 'g'))) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT songs_same_file UNIQUE (content_hash),
  CONSTRAINT songs_same_title_artist UNIQUE (title_key, artist_key)
);
```

```sql
-- Plays (for "Popular this week") and song requests
CREATE TABLE plays (
  id bigserial PRIMARY KEY,
  song_id uuid NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  device text NOT NULL,                       -- random install ID from the app
  played_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX plays_recent ON plays (played_at, song_id);
CREATE INDEX plays_device_song ON plays (device, song_id, played_at DESC);

CREATE TABLE song_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL, artist text, note text,
  device text NOT NULL,
  done boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX song_requests_device ON song_requests (device, created_at DESC);
```

## Accounts and sync

Neon Auth (Managed Better Auth) is enabled on the branch; users and sessions live in the `neon_auth` schema. Neon injects `NEON_AUTH_BASE_URL` into the function. `https://viberoom.expo.app` is a trusted domain (needed for sign-in requests and the Google return address).

The app never calls Neon Auth itself: `/auth/sign-up`, `/auth/sign-in`, `/auth/google`, `/auth/google/finish`, `/auth/session` and `/auth/sign-out` do it and return a `session` string (the value of Neon Auth's session cookie). The app keeps it in secure storage and sends it as the `x-session` header. This avoids cross-site cookies, which phones and Safari don't keep.

`POST /me/library` syncs a device's likes, playlists, recently played and stats:

```sql
CREATE TABLE user_library (
  user_id text PRIMARY KEY,          -- neon_auth.user.id
  doc jsonb NOT NULL DEFAULT '{}',   -- { liked, playlists, recent, removed, stats: { devices } }
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
```

Google sign-in on the phone uses a hand-off, because Android doesn't reliably pass the return link to the app (Chrome blocks a page from opening an app without a tap, and the app may be restarted meanwhile). `/auth/google` with a return address containing `app=1` adds a one-time id `h` to it and keeps Google's challenge under that id. The website's return page sends the code there (`/auth/google/handoff`), and the app collects the session (`/auth/google/claim`) while it waits, when it comes back to the front, and when it starts. Rows are deleted after 15 minutes.

```sql
CREATE TABLE google_handoff (
  id text PRIMARY KEY,                -- the one-time id (32 hex)
  challenge text,                     -- Neon Auth's challenge cookie from the start
  verifier text,                      -- Google's one-time code, left by the return page
  session text,                       -- set once claimed (asking again within 15 min gives it again)
  created_at timestamptz NOT NULL DEFAULT now()
);
```

The device sends its whole state; `mergeLibrary` merges it with the stored one (the newest change wins; deletions are kept for 180 days so an older copy can't bring something back; each device's stats are stored separately and added up), saves it with a version check (two devices syncing at once retry), and returns the result plus the other devices' stats.
