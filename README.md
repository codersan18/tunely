# VibeRoom — a music app (React Native + Expo)

Expo SDK 58 · React Native 0.88 · React Navigation 7 · expo-audio

## Download (Android)

**[⬇ Download VibeRoom for Android (APK)](https://expo.dev/artifacts/eas/yQuy8uuxWtYjnGRhS2m7pYVcEvYaYlO55qHXBGbKumg.apk)**

Open the link on your Android phone. When the download finishes, tap it to install, and allow "Install unknown apps" if Android asks. If Play Protect warns about an unknown app, tap **More details → Install anyway**.

## Features
- **Your own music library** – songs you upload are stored online (Neon) and appear in every install of the app
- **Manage songs (admin)** – Library → lock icon → admin password. Pick audio files, edit title / artist / album / genre, add a cover, upload. Songs already in the library are skipped (same file, or same title + artist). Remove songs from the Library tab.
- **Home** – quick tiles (All songs, Liked, Downloaded, your playlists), Jump back in, Recently added, Artists, All songs. Pull down to refresh.
- **Search** – searches the library on the phone (works offline); browse by artist and genre
- **Your Library** – All songs, Liked Songs, Downloaded, your playlists, artists
- **Playlist / Artist / Genre pages** – play, shuffle, download the whole list
- **Now Playing** – full-screen player with drag-to-seek bar, prev/next, shuffle, repeat (off / all / one), like
- **Mini player** above the tab bar with live progress
- Background playback and lock-screen controls

### Premium-style features
- **Offline downloads** – download a song (••• menu) or a whole playlist (↓ button); downloaded songs play from the phone with no internet. Library → Downloaded shows them and the storage used.
- **Queue** – "Play next" / "Add to queue" from any song's menu; the Queue screen (list icon in the player) lets you jump to a song, remove songs, or clear Up Next.
- **Smart shuffle** – tap the shuffle button twice (sparkle icon). After each song it plays the closest match from the whole library: same language and mood first, then genre and artist. It avoids repeats and songs you skipped; "Play next" songs still come first. Set each song's Language and Mood when uploading, or edit them in Manage songs → Library.
- **Sleep timer** – moon icon in the player: 5–60 minutes or end of the current song.
- **Your own playlists** – create (+ in Library), add songs, remove songs, rename, delete.
- **Saved on the phone** – liked songs, playlists and downloads survive app restarts (AsyncStorage + expo-file-system).
- **No ads, unlimited skips, play any song in any order.**

## Project structure
```
App.js                         Providers + navigator
src/context/PlayerContext.js   Playback: queue, shuffle, repeat, sleep timer (useAudioPlayer)
src/context/LibraryContext.js  Likes, playlists, downloads — persisted to the phone
src/navigation/AppNavigator.js Root stack (Tabs + Player modal), tab stacks, mini player in tab bar
src/context/CatalogContext.js  The shared song library (from the server, saved on the phone for offline)
src/screens/                   Home, Search, Library, Playlist, Player, Queue, Admin (manage songs)
src/components/                TrackRow, MiniPlayer, Cover, sheets
src/api/catalog.js             Talks to the backend: list songs, admin upload / delete
backend/                       The Neon Function behind the app (see backend/README.md)
src/theme.js                   Colours + time formatter
```

## Run it in development
```bash
npm install
npx expo start          # press "a" for an Android emulator
```
Background playback and lock-screen controls need a real build (dev build or APK), not Expo Go.

## Build the APK

### Option A — Expo cloud build (easiest, no Android SDK needed)
```bash
npm install -g eas-cli
eas login                       # free Expo account
eas build:configure             # accept defaults; eas.json is already set up
eas build -p android --profile preview
```
When it finishes you get a download link/QR code for the `.apk`. Install it on your phone.

### Option B — Local build (needs Android Studio + JDK 17)
```bash
npm install
npx expo prebuild -p android
cd android
./gradlew assembleRelease       # Windows: gradlew.bat assembleRelease
```
APK: `android/app/build/outputs/apk/release/app-release.apk`
(The release build is signed with the debug key by default — fine for sideloading/testing.
For the Play Store, create your own keystore and use `--profile production` to get an .aab.)

## How songs get to everyone
1. You unlock **Manage songs** with the admin password and upload files.
2. The backend checks for duplicates, stores the audio in Neon Object Storage and the details in Postgres.
3. Every phone loads the song list on start (pull down on Home to refresh) and streams from storage.

**Offline:** the song list is saved on the phone, and **downloaded** songs play with no internet
(download from a song's ••• menu or a playlist's ↓ button). Songs that aren't downloaded need internet.

Only upload music you own or have permission to share: everyone who installs the app can play it.

## Shipping changes

| You change | What happens |
|---|---|
| Songs (in the app's admin screen) | Live for everyone right away. |
| App code (screens, design, features) | Push to `main`. GitHub Actions runs `eas update` and every installed app picks it up the next time it is opened. |
| Icon, name, splash, or a package with native code | Build a new APK (`npx eas-cli@latest build --profile preview --platform android`) and share the new link. |

Updates use the `fingerprint` runtime version, so an update only reaches APKs with matching native code. Builds from before over-the-air updates were added (the first two) can't receive updates.

The workflow (`.github/workflows/update.yml`) needs an Expo access token saved as the `EXPO_TOKEN` repository secret. To publish by hand instead: `npx eas-cli@latest update --channel preview --environment preview --message "what changed"`.

## Song compression

Uploaded songs are compressed automatically by `.github/workflows/optimize.yml` (every 15 minutes, or run it by hand from the Actions tab). Audio above 160 kbps is re-encoded to AAC 128 kbps `.m4a` (a 320 kbps MP3 becomes about 60% smaller), the cover embedded in the file is used if the song has none, and the song length is filled in. The original file is then deleted. The duplicate check still uses the original file's fingerprint.

Needs the `VIBEROOM_ADMIN_KEY` repository secret (the admin password). To run it yourself: `ADMIN_KEY=... node scripts/optimize-songs.mjs` with `ffmpeg` installed.
