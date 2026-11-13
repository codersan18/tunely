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
| POST | `/admin/verify` | admin | check the password |
| POST | `/admin/prepare` | admin | duplicate check, returns 15-minute upload URLs |
| POST | `/admin/songs` | admin | save the song once the file is uploaded |
| PATCH | `/admin/songs/:id` | admin | edit title, artist, album, genre, language, mood |
| DELETE | `/admin/songs/:id` | admin | remove a song and its files |
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
