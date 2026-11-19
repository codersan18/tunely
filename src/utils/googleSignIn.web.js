// Google sign-in on the website (googleSignIn.js is the phone version).
// The page goes to Google and comes back to /auth/callback?neon_auth_session_verifier=…, where
// AuthContext finishes signing in. The challenge waits in sessionStorage meanwhile.
// The same callback page also serves the phone app: with ?app=1 it forwards to viberoom://.
import { startGoogle } from '../api/auth';

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

/** Phone only (the website finishes in pendingGoogleReturn). */
export const lateGoogleReturn = async () => null;

/** Back from Google on the website: { verifier, challenge } or null. */
export async function pendingGoogleReturn() {
  if (!isCallback()) return null;
  const verifier = verifierFrom(window.location.href);
  let challenge = '';
  try { challenge = sessionStorage.getItem(PENDING_KEY) || ''; sessionStorage.removeItem(PENDING_KEY); } catch (e) { /* ignore */ }
  clearUrl();
  return verifier ? { verifier, challenge } : null;
}

/**
 * The link that hands the phone's sign-in to the app, or null when this isn't that page.
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
 * The phone's sign-in finished in a browser tab: hand the code to the app. true if forwarding.
 * Chrome on Android often blocks a page from opening an app without a tap, so App.js also shows
 * an "Open VibeRoom" button that opens appReturnUrl().
 */
export function forwardToApp() {
  const url = appReturnUrl();
  if (!url) return false;
  try { window.location.href = url; } catch (e) { /* blocked: the button is there */ }
  return true;
}
