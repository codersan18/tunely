// Google sign-in on the website (googleSignIn.js is the phone version).
// The page goes to Google and comes back to /auth/callback?neon_auth_session_verifier=…, where
// AuthContext finishes signing in. The challenge waits in sessionStorage meanwhile.
// The same callback page also serves the phone app (?app=1): it leaves the code with the backend
// for the app to collect (h = the app's handoff id) and tries to open the app.
import { startGoogle, finishGoogle, handOffGoogle } from '../api/auth';

const PENDING_KEY = 'viberoom:google:v1';
const isCallback = () => typeof window !== 'undefined' && window.location.pathname.replace(/\/+$/, '') === '/auth/callback';

export function verifierFrom(url) {
  if (typeof url !== 'string' || !/auth\/callback/.test(url)) return null;
  const m = url.match(/[?&]neon_auth_session_verifier=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function googleFlow() {
  const { url, challenge } = await startGoogle(`${window.location.origin}/auth/callback`);
  try { sessionStorage.setItem(PENDING_KEY, challenge); } catch (e) { /* private mode */ }
  window.location.assign(url);
  return new Promise(() => {}); // the page is leaving
}

const clearUrl = () => { try { window.history.replaceState(null, '', '/'); } catch (e) { /* ignore */ } };

/** Phone only. */
export const resumeGoogle = async () => null;
export const cancelGoogle = () => {};

/** Back from Google on the website: { session, user }, or null when this isn't the return page. */
export async function pendingGoogleReturn() {
  if (!isCallback()) return null;
  const verifier = verifierFrom(window.location.href);
  let challenge = '';
  try { challenge = sessionStorage.getItem(PENDING_KEY) || ''; sessionStorage.removeItem(PENDING_KEY); } catch (e) { /* ignore */ }
  clearUrl();
  return verifier ? finishGoogle(verifier, challenge) : null;
}

/**
 * The link that opens the phone app from the return page, or null when this isn't that page.
 * On Android it's an intent:// link naming the app, which Chrome opens more reliably than viberoom://.
 */
export function appReturnUrl() {
  if (!isCallback()) return null;
  const search = window.location.search;
  if (new URLSearchParams(search).get('app') !== '1') return null;
  if (/android/i.test(navigator.userAgent || '')) {
    return `intent://auth/callback${search}#Intent;scheme=viberoom;package=com.tunely.app;end`;
  }
  return `viberoom://auth/callback${search}`;
}

/**
 * The phone's sign-in finished in a browser tab: leave the code with the backend for the app, then
 * try to open the app. true if this is that page. Chrome on Android often blocks opening an app
 * without a tap, so App.js also shows an "Open VibeRoom" button; the app also collects the
 * sign-in by itself when the person switches back to it.
 */
export function forwardToApp() {
  const url = appReturnUrl();
  if (!url) return false;
  const handoff = new URLSearchParams(window.location.search).get('h');
  const verifier = verifierFrom(window.location.href);
  const open = () => { try { window.location.href = url; } catch (e) { /* blocked: the button is there */ } };
  if (handoff && verifier) handOffGoogle(handoff, verifier).catch(() => {}).finally(open);
  else open();
  return true;
}
