# VibeRoom — a music app (React Native + Expo)

Expo SDK 58 · React Native 0.88 · React Navigation 7 · expo-audio

## Download (Android)

**[⬇ Download VibeRoom for Android (APK, 22 MB)](https://github.com/codersan18/tunely/releases/latest/download/VibeRoom.apk)**

Open the link on your Android phone. When the download finishes, tap it to install, and allow "Install unknown apps" if Android asks. If Play Protect warns about an unknown app, tap **More details → Install anyway**.

## Listen on a computer

**[▶ Open VibeRoom in your browser](https://viberoom.expo.app)**

It's the same app with the same song library and every feature, running in Chrome, Edge or any modern browser:
- **Manage songs:** Library → 🔒. Upload songs straight from your computer: pick many files at once, and their details are read from the files.
- **Offline downloads:** songs are saved in the browser. Once the site has been opened, it also opens without internet.
- **Media controls:** play/pause and next/previous work from the keyboard's media keys and the browser's media controls instead of the lock screen.

The admin password is remembered in that browser until you tap **Lock**.

The website rebuilds itself on every push to `main` (`.github/workflows/web.yml`). The browser-specific code is in the `*.web.js` files (`src/utils/files.web.js`, `offline.web.js`, `serviceWorker.web.js`) and `public/sw.js`. The phone uses the matching files without `.web`.

To try the web version locally:

```bash
npm install --no-save react-dom@19.3.0 react-native-web@0.21.4 @expo/metro-runtime@58.0.17
npx expo start --web
```

The web packages are kept out of `package.json` on purpose. With them listed there, Expo adds "web" to the app's platforms, which changes the phone app's runtime version and would cut installed APKs off from over-the-air updates.

## Features
- **Your own music library** – songs you upload are stored online (Neon) and appear in every install of the app
- **Manage songs (admin)** – Library → lock icon → admin password. Pick audio files, edit title / artist / album / genre, add a cover, upload. Songs already in the library are skipped (same file, or same title + artist). Remove songs from the Library tab.
- **Home** – quick tiles (All songs, Liked, Downloaded, your playlists), Jump back in, Popular this week, Recently added, Artists, All songs. Pull down to refresh.
- **Search** – searches the library and the songs on the phone (works offline); browse by artist and genre. "Can't find it?" asks for the song to be added.
- **Your Library** – All songs, Liked Songs, Downloaded, On this phone, your playlists, artists
- **On this phone** (Android) – Library → On this phone plays songs already saved on the phone straight from their files; nothing is copied or uploaded. The first time, tap **Allow access** ("Music and audio" permission only). Songs are in three sections by folder: **Songs** (Music, Download and the rest), **WhatsApp audio**, and **Others** (recordings, call recordings, Telegram, podcasts…), and can be browsed by **Artists**, **Albums** and **Folders**. Title, artist, album and cover come from the file's tags (MP3, M4A and FLAC), or from the file name ("Artist - Title.mp3"); files under 30 seconds are left out. Covers are read when shown and kept in memory; only the playing song's cover is written to the cache, for the lock screen. The admin can send a phone song to the library from its ••• menu (**Add to VibeRoom library**). Code: `src/context/LocalMusicContext.js`, `src/screens/LocalMusicScreen.js`.
- **Audio editor & ringtones** (Android) – any song's ••• menu → **Cut / make ringtone**, or Library → **Ringtones & edits** → New edit (any audio file on the phone). Drag the handles on the waveform to cut (or use the ± buttons, the length chips, or "Start here / End here" while it plays), add a fade in / fade out, change the volume, and shape the sound with a 5-band equalizer and presets (Bass boost, Vocal, Rock…). Play shows changes as you make them. **Save** makes an AAC .m4a file on the phone and can set it straight away as the **ringtone**, **alarm** or **notification / SMS** sound. Setting a sound needs Android's "Modify system settings" permission, which the app asks for the first time. Files go in the phone's own `Ringtones/VibeRoom`, `Alarms/VibeRoom`, `Notifications/VibeRoom` or `Music/VibeRoom` folder, so they also appear in Android's sound pickers and stay if the app is removed. Library → Ringtones & edits lists them, shows which one is your current ringtone, alarm and notification sound, and can play, edit again, set or delete them. Everything happens on the phone: songs from the library are read into memory for editing, and only the finished edit is saved. The native code is a local Expo module, `modules/audio-editor` (Android MediaCodec decode → equalizer / volume / fades → AAC encode, plus MediaStore and RingtoneManager).
- **Playlist / Artist / Genre pages** – play, shuffle, download the whole list
- **Now Playing** – full-screen player with drag-to-seek bar, prev/next, shuffle, repeat (off / all / one), like
- **Mini player** above the tab bar with live progress
- Background playback and lock-screen controls

### Premium-style features
- **Offline downloads** – download a song (••• menu) or a whole playlist (↓ button); downloaded songs play from the phone with no internet. Library → Downloaded shows them and the storage used.
- **Queue** – "Play next" / "Add to queue" from any song's menu; the Queue screen (list icon in the player) lets you jump to a song, remove songs, or clear Up Next.
- **Smart shuffle** – tap the shuffle button twice (sparkle icon). After each song it plays the closest match from the whole library: same language and mood first, then genre and artist. It avoids repeats and songs you skipped; "Play next" songs still come first. Set each song's Language and Mood when uploading, or edit them in Manage songs → Library.
- **Sleep timer** – moon icon in the player: 5–60 minutes or end of the current song. The music fades out over the last 30 seconds.
- **Carry on where you left off** – the queue, song and position are saved; reopening the app brings them back, paused.
- **Playback speed** – the 1× button in the player: 0.75× to 2×.
- **Smooth transitions** – Library → ⚙ Settings: songs fade out and in (3, 6 or 10 s).
- **Data saver** – Settings: on mobile data the player loads only ~50 s ahead instead of the whole song and the next one (needs the patched expo-audio, see below).
- **Popular this week** – the most played library songs by everyone in the last 7 days (Home, and "See all"). The app counts a play after 30 seconds, once per phone per song per 10 minutes, with a random install ID (nothing personal).
- **Your VibeRoom** – Library → 📊: listening time, top songs and top artists this month, this year or all time. Kept on the phone only.
- **Ask for a song** – from Search or Settings; requests show up for the admin in Manage songs → Requests.
- **Share** – a song's ••• menu → Share sends `https://viberoom.expo.app/?song=<id>`. It opens the song in the app on Android (app links, `public/.well-known/assetlinks.json`) or on the website.
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
modules/audio-editor/          Native audio editor (cut, equalizer, fades, save, set ringtone)
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
| App code (screens, design, features) | Push to `main`. GitHub Actions runs `eas update`, and every installed app picks it up the next time it is opened. The website at viberoom.expo.app is rebuilt at the same time. |
| Icon, name, splash, or a package with native code | Build a new APK (`npx eas-cli@latest build --profile preview --platform android`), then release it: `node scripts/release-apk.mjs "what's new"`. Installed apps then show **New version available** with a Download button. |

### Releasing a new APK

`scripts/release-apk.mjs` takes the newest finished Android build from EAS and publishes it as a GitHub release, with the file named `VibeRoom.apk`. The download link at the top always gives the latest release, so it never changes. It needs `npx eas-cli@latest login` and `gh auth login`.

Start the EAS build from a clean, pushed commit (`git status` shows nothing). The runtime version is a fingerprint of the project files, so leftovers such as build folders give the APK a runtime that GitHub's updates never match. The script refuses to release such a build (`--force` releases it anyway). `.gitattributes` keeps line endings the same on Windows and on GitHub's Linux machines for the same reason, and `.fingerprintignore` leaves out the native modules' build caches.

The release notes end with a hidden line, `<!-- runtime: <hash> -->`: the build's runtime version (a fingerprint of its native code). When the app opens, `src/utils/newVersion.js` reads the latest release from GitHub. If that runtime isn't the app's own, it shows **New version available**. "Later" hides it for 3 days. If you publish a release by hand, copy that line from the build's details on expo.dev (Runtime version), or the message won't show.

### Patched expo-audio

`patches/expo-audio+58.0.12.patch` changes these things in expo-audio's Android code, and `package.json` builds expo-audio from source (`expo.autolinking.buildFromSource`) so the patch is used. `npm install` applies it (`postinstall: patch-package`).
- The lock screen session only received 2 of the player's events. It never learned that a song had been added, so the app crashed when the next song started (`Invalid PlayerInfo update`), and the lock screen's play button kept showing loading. Same fix as [expo/expo#52193](https://github.com/expo/expo/pull/52193).
- `play()` did nothing after a playback error (no internet, missing file). It now prepares the player again, so the app retries the same song instead of rebuilding the player.
- The playlist player loads up to 10 minutes (max 40 MB) ahead instead of Android's default 50 seconds; with **data saver** (the playlist's `dataSaver` property, set by the app on mobile data) it stops at 50 seconds again. It loads the rest of the current song, then the next song, into memory, so a weak network doesn't make songs stall. Nothing is saved to the phone's storage.

When upgrading expo-audio, check whether #52193 is included. If it is, drop that part of the patch. The `play()` part stays until expo-audio does the same.

Updates use the `fingerprint` runtime version, so an update only reaches APKs with matching native code. Builds from before over-the-air updates were added (the first two) can't receive updates.

The workflow (`.github/workflows/update.yml`) needs an Expo access token saved as the `EXPO_TOKEN` repository secret. To publish by hand instead: `npx eas-cli@latest update --channel preview --environment preview --message "what changed"`.

## Song compression

Uploaded songs are compressed automatically by `.github/workflows/optimize.yml` (the backend starts it right after each upload; it also has a 15-minute schedule as a backup, and you can run it by hand from the Actions tab). Audio above 160 kbps is re-encoded to AAC 128 kbps `.m4a` (a 320 kbps MP3 becomes about 60% smaller), the cover embedded in the file is used if the song has none, and the song length is filled in. The original file is then deleted. The duplicate check still uses the original file's fingerprint.

Needs the `VIBEROOM_ADMIN_KEY` repository secret (the admin password). To run it yourself: `ADMIN_KEY=... node scripts/optimize-songs.mjs` with `ffmpeg` installed.

## Storage limit

The Neon Free plan includes 5 GB of object storage. The backend measures the bucket directly and **refuses new uploads at 90%** (the upload screen shows a storage bar and disables Upload). `.github/workflows/storage-alert.yml` checks every 3 hours and, at 90%, opens a GitHub issue assigned to the repo owner, which GitHub emails to you; the issue closes itself once usage drops. Set `STORAGE_LIMIT_BYTES` on the Neon Function if the plan changes.
