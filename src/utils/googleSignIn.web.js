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

/** Back from Google on the website: { verifier, challenge } or null. */
export async function pendingGoogleReturn() {
  if (!isCallback()) return null;
  const verifier = verifierFrom(window.location.href);
  let challenge = '';
  try { challenge = sessionStorage.getItem(PENDING_KEY) || ''; sessionStorage.removeItem(PENDING_KEY); } catch (e) { /* ignore */ }
  clearUrl();
  return verifier ? { verifier, challenge } : null;
}

/** The phone's sign-in finished in a browser tab: hand the code to the app. true if forwarding. */
export function forwardToApp() {
  if (!isCallback()) return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get('app') !== '1') return false;
  window.location.replace(`viberoom://auth/callback${window.location.search}`);
  return true;
}
