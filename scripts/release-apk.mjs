// Publishes the newest finished Android build (EAS, "preview" profile) as a GitHub release, so the
// permanent link (README → Download) serves it and installed apps show "New version available".
//
//   node scripts/release-apk.mjs "What's new in this version"
//
// Needs: logged in to EAS (npx eas-cli@latest login) and to GitHub (gh auth login).

import { execSync } from 'node:child_process';
import { existsSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = 'codersan18/tunely';
const notes = process.argv.slice(2).join(' ').trim();
if (!notes) {
  console.error('Usage: node scripts/release-apk.mjs "What\'s new in this version"');
  process.exit(1);
}

const run = (cmd) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

// GitHub CLI: from PATH, or (Windows) its install folder. A terminal opened before gh was
// installed doesn't have it on PATH yet.
const GH_WINDOWS = 'C:\\Program Files\\GitHub CLI\\gh.exe';
const gh = (() => {
  try {
    execSync(process.platform === 'win32' ? 'where gh' : 'command -v gh', { stdio: 'ignore' }); // quiet check
    return 'gh';
  } catch (e) { /* not on PATH */ }
  if (process.platform === 'win32' && existsSync(GH_WINDOWS)) return `"${GH_WINDOWS}"`;
  console.error('GitHub CLI (gh) not found. Install it (winget install GitHub.cli), open a new terminal and run gh auth login.');
  process.exit(1);
})();
const json = (out) => JSON.parse(out.slice(out.search(/[[{]/)));

// 1. The newest finished preview build.
const [build] = json(run('npx eas-cli@latest build:list --platform android --status finished --build-profile preview --limit 1 --non-interactive --json'));
if (!build?.artifacts?.buildUrl) throw new Error('No finished Android preview build found on EAS.');
const runtime = build.runtime?.version || build.runtimeVersion;
const commit = build.gitCommitHash;
if (!runtime || !commit) throw new Error('The build has no runtime version or commit; can\'t release it.');

// 2. Not released already?
const releases = json(run(`${gh} release list -R ${REPO} --limit 50 --json tagName`)).map((r) => r.tagName);
for (const tag of releases) {
  const body = json(run(`${gh} release view ${tag} -R ${REPO} --json body`)).body || '';
  if (body.includes(`runtime: ${runtime}`)) {
    console.log(`This build (runtime ${runtime}) is already released as ${tag}. Nothing to do.`);
    process.exit(0);
  }
}

// 3. Download the APK.
const dir = mkdtempSync(join(tmpdir(), 'viberoom-'));
const apk = join(dir, 'VibeRoom.apk');
console.log(`Downloading build from commit ${commit.slice(0, 7)}…`);
const res = await fetch(build.artifacts.buildUrl);
if (!res.ok) throw new Error(`Download failed (${res.status})`);
writeFileSync(apk, Buffer.from(await res.arrayBuffer()));

// 4. Publish. The hidden runtime line is what installed apps compare against (src/utils/newVersion.js).
let tag = `android-${new Date().toISOString().slice(0, 10)}`;
for (let n = 2; releases.includes(tag); n += 1) tag = `android-${new Date().toISOString().slice(0, 10)}-${n}`;
const body = [
  'Install on an Android phone: open this page on the phone, tap **VibeRoom.apk**, then open the download and allow "Install unknown apps" if asked. Your liked songs, playlists and downloads stay.',
  '',
  "What's new:",
  notes,
  '',
  `<!-- runtime: ${runtime} -->`,
].join('\n');
const notesFile = join(dir, 'notes.md');
writeFileSync(notesFile, body);
run(`${gh} release create ${tag} "${apk}#VibeRoom.apk" -R ${REPO} --target ${commit} --title "VibeRoom for Android" --latest --notes-file "${notesFile}"`);
console.log(`Released ${tag}: https://github.com/${REPO}/releases/tag/${tag}`);
console.log(`Download link (always the latest): https://github.com/${REPO}/releases/latest/download/VibeRoom.apk`);
