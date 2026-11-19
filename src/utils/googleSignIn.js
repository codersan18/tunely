// Google sign-in on the phone.
//
// 1. The backend gives us Google's sign-in page and a "challenge" (kept until we're back).
// 2. The page opens in a browser tab. After Google, Neon Auth sends the browser to
//    https://viberoom.expo.app/auth/callback?app=1&neon_auth_session_verifier=…
//    Android may open that link straight in the app (App Link), or the website's callback page
//    forwards it to viberoom://auth/callback?… (see googleSignIn.web.js). Either way we get it here.
// 3. The one-time code + challenge are exchanged for a session (AuthContext).
import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { startGoogle } from '../api/auth';

const CALLBACK = 'https://viberoom.expo.app/auth/callback?app=1';
const APP_RETURN = 'viberoom://auth/callback';
const PENDING_KEY = 'viberoom:google:v1'; // the challenge, in case Android restarts the app meanwhile

/** The one-time code in a return link, or null. */
export function verifierFrom(url) {
  if (typeof url !== 'string' || !/auth\/callback/.test(url)) return null;
  const m = url.match(/[?&]neon_auth_session_verifier=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

/** Signs in with Google: resolves { verifier, challenge }, or null if the person gave up. */
export async function googleFlow() {
  const { url, challenge } = await startGoogle(CALLBACK);
  await AsyncStorage.setItem(PENDING_KEY, challenge).catch(() => {});
  return new Promise((resolve) => {
    let done = false;
    const finish = (verifier) => {
      if (done) return;
      done = true;
      sub.remove();
      WebBrowser.dismissBrowser().catch(() => {});
      AsyncStorage.removeItem(PENDING_KEY).catch(() => {});
      resolve(verifier ? { verifier, challenge } : null);
    };
    const sub = Linking.addEventListener('url', (e) => { const v = verifierFrom(e.url); if (v) finish(v); });
    WebBrowser.openAuthSessionAsync(url, APP_RETURN)
      .then((r) => {
        if (r.type === 'success') finish(verifierFrom(r.url));
        // Closed without a link (yet): an App Link can arrive just after the tab closes.
        else setTimeout(() => finish(null), 2000);
      })
      .catch(() => finish(null));
  });
}

/** App opened by the return link after Android closed it during sign-in: { verifier, challenge } or null. */
export async function pendingGoogleReturn() {
  const verifier = verifierFrom(await Linking.getInitialURL().catch(() => null));
  if (!verifier) return null;
  const challenge = await AsyncStorage.getItem(PENDING_KEY).catch(() => null);
  AsyncStorage.removeItem(PENDING_KEY).catch(() => {});
  return { verifier, challenge: challenge || '' };
}

/** Web only: the callback page opened in a phone's browser tab. */
export const forwardToApp = () => false;
