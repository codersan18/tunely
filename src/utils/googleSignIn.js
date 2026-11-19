// Google sign-in on the phone.
//
// 1. The backend gives us Google's sign-in page and a "handoff" id (it keeps the challenge).
// 2. The page opens in a browser tab. After Google, Neon Auth sends the tab to
//    https://viberoom.expo.app/auth/callback?app=1&h=<handoff>&neon_auth_session_verifier=…
//    That page leaves the code with the backend under the handoff id and tries to open the app
//    (with an "Open VibeRoom" button, since Chrome may block opening apps without a tap).
//    Android may also open the link straight in the app (App Link).
// 3. The app collects the session with the handoff id (/auth/google/claim): while it waits, when it
//    comes back to the front, and when it starts. So sign-in finishes even if Android doesn't pass
//    the link to the app, or restarts the app meanwhile.
import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { startGoogle, claimGoogle } from '../api/auth';

const CALLBACK = 'https://viberoom.expo.app/auth/callback?app=1';
const APP_RETURN = 'viberoom://auth/callback';
const PENDING_KEY = 'viberoom:google:v2'; // { handoff, at }: a sign-in that may still finish
const PENDING_MS = 15 * 60 * 1000; // the backend keeps a handoff for 15 minutes
const POLL_MS = 2500;
const GRACE_MS = 8000; // after the tab closes, keep asking a little (the page may still be handing off)
let waiting = false; // googleFlow is waiting

/** The one-time code in a return link, or null. */
export function verifierFrom(url) {
  if (typeof url !== 'string' || !/auth\/callback/.test(url)) return null;
  const m = url.match(/[?&]neon_auth_session_verifier=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}
const handoffFrom = (url) => (typeof url === 'string' && /auth\/callback/.test(url) ? url.match(/[?&]h=([0-9a-f]{32})\b/)?.[1] || null : null);

async function savedHandoff() {
  try {
    const p = JSON.parse((await AsyncStorage.getItem(PENDING_KEY)) || 'null');
    return p?.handoff && Date.now() - p.at < PENDING_MS ? p.handoff : null;
  } catch (e) {
    return null;
  }
}
const forget = () => AsyncStorage.removeItem(PENDING_KEY).catch(() => {});

/** One try: { session, user } when signed in, null while the person is still on Google. */
async function claim(handoff, verifier) {
  const data = await claimGoogle(handoff, verifier || undefined);
  if (data?.pending) return null;
  forget();
  return data;
}

/** Signs in with Google: resolves { session, user }, or null if the person gave up. */
export async function googleFlow() {
  const { url, handoff } = await startGoogle(CALLBACK);
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify({ handoff, at: Date.now() })).catch(() => {});
  waiting = true;
  return new Promise((resolve, reject) => {
    let done = false;
    let asking = false;
    let verifier = null;
    let closedAt = 0;
    const end = (fn) => {
      if (done) return;
      done = true;
      waiting = false;
      clearInterval(timer);
      sub.remove();
      WebBrowser.dismissBrowser().catch(() => {});
      fn();
    };
    const ask = async () => {
      if (done || asking) return;
      asking = true;
      try {
        const data = await claim(handoff, verifier);
        if (data) end(() => resolve(data));
        // Back in the app without finishing Google: stop (a late finish is picked up by resumeGoogle).
        else if (closedAt && Date.now() - closedAt > GRACE_MS) end(() => resolve(null));
      } catch (e) {
        if (e.code !== 'offline') { forget(); end(() => reject(e)); }
      } finally {
        asking = false;
      }
    };
    const timer = setInterval(ask, POLL_MS);
    const sub = Linking.addEventListener('url', (e) => {
      const h = handoffFrom(e.url);
      if (h && h !== handoff) return; // an older sign-in's link
      verifier = verifierFrom(e.url) || verifier;
      ask();
    });
    WebBrowser.openAuthSessionAsync(url, APP_RETURN)
      .then((r) => { if (r.type === 'success') verifier = verifierFrom(r.url) || verifier; })
      .catch(() => {})
      .finally(() => { closedAt = Date.now(); ask(); });
  });
}

/**
 * Finishes a Google sign-in that's still open: one started before the app was restarted, or one
 * whose return link (url, optional) came after googleFlow stopped waiting.
 * { session, user } when signed in, otherwise null.
 */
export async function resumeGoogle(url) {
  if (waiting) return null; // googleFlow handles it
  const fromLink = handoffFrom(url);
  const handoff = fromLink || (await savedHandoff());
  if (!handoff) return null;
  try {
    return await claim(handoff, verifierFrom(url));
  } catch (e) {
    if (e.status === 404) { forget(); return null; } // too old: nothing to finish
    if (e.code !== 'offline') forget();
    throw e;
  }
}

/** At start: finish a Google sign-in, if one is open (the app may have been opened by its link). */
export async function pendingGoogleReturn() {
  return resumeGoogle(await Linking.getInitialURL().catch(() => null));
}

/** Web only: the callback page opened in a phone's browser tab. */
export const forwardToApp = () => false;
export const appReturnUrl = () => null;
