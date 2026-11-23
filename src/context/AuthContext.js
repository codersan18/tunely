import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { keyStore } from '../utils/files';
import {
  checkSession, signInWithEmail, signOutSession, signUpWithEmail,
  requestPasswordReset, resetPasswordWithCode,
} from '../api/auth';
import { googleFlow, pendingGoogleReturn, resumeGoogle, cancelGoogle, forwardToApp, googleReturnPending } from '../utils/googleSignIn';
import { clearLibraryForSignOut } from './LibraryContext';
import { clearStats } from '../utils/stats';
import { removeAllScopes, setProfileScope, MAIN_PROFILE } from '../utils/profileScope';

// The signed-in account. Signing in is required (App.js shows SignInScreen until then).
// The session string lives in secure storage (phone) / localStorage (web); the account's name
// and email are also kept so the app opens signed in without internet. The session is checked
// with the server in the background; if it was ended (signed out elsewhere, expired), the app
// signs out.

const SESSION_KEY = 'viberoom.session';
const USER_KEY = 'viberoom:user:v1';
const RETURN_WAIT_TRIES = 5; // after a restart during Google sign-in: ask the server for it for up to ~8 s
const RESUME_KEY = 'tunely:player:v1'; // the player's saved queue (PlayerContext)
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // loading | signed-out | signed-in | forwarding (web page handing Google's answer to the phone app)
  const [status, setStatus] = useState(() => (forwardToApp() ? 'forwarding' : 'loading'));
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Signing in with Google: the sign-in screen shows "Signing you in" instead of the form, so
  // coming back from Google goes straight to the app.
  const [googleBusy, setGoogleBusy] = useState(false);
  const [justSignedIn, setJustSignedIn] = useState(false); // this start of the app signed in (the loading screens say so)
  const sessionRef = useRef(null); sessionRef.current = session;
  const signedInRef = useRef(false); signedInRef.current = status === 'signed-in';
  const startWaiting = useRef(false); // the start is waiting for a Google sign-in after a restart

  const signedIn = useCallback(async (data) => {
    if (!data?.session) {
      setError(data?.message || 'Sign-in didn\'t finish. Try again.');
      return false;
    }
    await keyStore.set(SESSION_KEY, data.session);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user)).catch(() => {});
    setSession(data.session);
    setUser(data.user);
    setError('');
    setJustSignedIn(true);
    setStatus('signed-in');
    return true;
  }, []);

  const clearAll = useCallback(async () => {
    await keyStore.remove(SESSION_KEY).catch(() => {});
    // The account's things on this device, for every profile (downloads stay): see ProfilesContext.
    await AsyncStorage.multiRemove([USER_KEY, 'viberoom:profiles:v1', 'viberoom:profile:v1']).catch(() => {});
    await removeAllScopes([RESUME_KEY]);
    setProfileScope(MAIN_PROFILE);
    await clearLibraryForSignOut();
    await clearStats();
    setSession(null);
    setUser(null);
    setGoogleBusy(false);
    setJustSignedIn(false);
    setStatus('signed-out');
  }, []);

  // The server says this session is over (signed out elsewhere or expired).
  const verify = useCallback(async () => {
    const s = sessionRef.current;
    if (!s) return;
    try {
      const { user: fresh } = await checkSession(s);
      setUser(fresh);
      AsyncStorage.setItem(USER_KEY, JSON.stringify(fresh)).catch(() => {});
    } catch (e) {
      if (e.status === 401) clearAll();
      // offline or server trouble: stay signed in
    }
  }, [clearAll]);

  // Start: restore the saved session, or else show the sign-in screen and finish a Google sign-in
  // we're coming back from (it shows as busy meanwhile, never as a blank screen).
  useEffect(() => {
    if (status === 'forwarding') return;
    (async () => {
      const saved = await keyStore.get(SESSION_KEY).catch(() => null);
      if (saved) {
        let cached = null;
        try { cached = JSON.parse((await AsyncStorage.getItem(USER_KEY)) || 'null'); } catch (e) { /* none */ }
        setSession(saved);
        setUser(cached);
        setStatus('signed-in');
        return;
      }
      // In the middle of a Google sign-in (back from it, or Android restarted the app meanwhile)?
      // Then the loading screen, never the form first.
      const returning = await googleReturnPending();
      if (returning) setGoogleBusy(true);
      setStatus('signed-out');
      setBusy(true);
      let ok = false;
      startWaiting.current = returning;
      try {
        let back = await pendingGoogleReturn();
        // Restarted before the browser handed the sign-in over: it arrives within seconds.
        for (let i = 0; returning && !back && i < RETURN_WAIT_TRIES && !signedInRef.current; i++) {
          await new Promise((r) => setTimeout(r, 1500));
          back = signedInRef.current ? null : await resumeGoogle(null);
        }
        if (back) ok = await signedIn(back);
        else if (signedInRef.current) ok = true; // the return link got there first
      } catch (e) {
        setError(e.message || 'Google sign-in didn\'t finish. Try again.');
      } finally {
        startWaiting.current = false;
        setBusy(false);
        if (!ok && !signedInRef.current) setGoogleBusy(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Phone, signed out: finish a Google sign-in that completes after the sign-in screen stopped
  // waiting (its return link arrives, or the person switches back to the app).
  const resuming = useRef(false);
  useEffect(() => {
    if (status !== 'signed-out') return undefined;
    const resume = async (url) => {
      if (resuming.current) return;
      resuming.current = true;
      const fromLink = typeof url === 'string' && /auth\/callback|app-return\.html/.test(url);
      if (fromLink) setGoogleBusy(true);
      let ok = false;
      try {
        const back = await resumeGoogle(url);
        if (back) { setGoogleBusy(true); ok = await signedIn(back); if (!ok) setGoogleBusy(false); }
      } catch (e) {
        setError(e.message);
      } finally {
        resuming.current = false;
        if (!ok && fromLink && !startWaiting.current) setGoogleBusy(false);
      }
    };
    const linkSub = Linking.addEventListener('url', (e) => resume(e.url));
    const appSub = AppState.addEventListener('change', (s) => { if (s === 'active') resume(null); });
    return () => { linkSub.remove(); appSub.remove(); };
  }, [status, signedIn]);

  // Check the session when signed in and whenever the app comes back.
  useEffect(() => {
    if (status !== 'signed-in') return undefined;
    verify();
    const sub = AppState.addEventListener('change', (s) => { if (s === 'active') verify(); });
    return () => sub.remove();
  }, [status, verify]);

  const run = useCallback(async (fn) => {
    setBusy(true);
    setError('');
    try { await fn(); } catch (e) { setError(e.message || 'Sign-in failed. Try again.'); } finally { setBusy(false); }
  }, []);

  const signInEmail = useCallback((email, password) => run(async () => signedIn(await signInWithEmail(email, password))), [run, signedIn]);
  const signUpEmail = useCallback((email, password, name) => run(async () => signedIn(await signUpWithEmail(email, password, name))), [run, signedIn]);
  const signInGoogle = useCallback(() => run(async () => {
    setGoogleBusy(true);
    let ok = false;
    try {
      const back = await googleFlow();
      if (back) ok = await signedIn(back);
    } finally {
      if (!ok) setGoogleBusy(false);
    }
  }), [run, signedIn]);

  // Forgot password: a 6-digit code by email, then the code + a new password (signs in).
  const sendResetCode = useCallback(async (email) => {
    let ok = false;
    await run(async () => { await requestPasswordReset(email); ok = true; });
    return ok;
  }, [run]);
  const resetPassword = useCallback((email, code, password) => run(async () => signedIn(await resetPasswordWithCode(email, code, password))), [run, signedIn]);

  const signOut = useCallback(async () => {
    const s = sessionRef.current;
    await clearAll();
    if (s) signOutSession(s);
  }, [clearAll]);

  const value = useMemo(() => ({
    status, user, session, busy, error, setError, googleBusy, cancelGoogle, justSignedIn,
    signInEmail, signUpEmail, signInGoogle, signOut, expired: clearAll, sendResetCode, resetPassword,
  }), [status, user, session, busy, error, googleBusy, justSignedIn, signInEmail, signUpEmail, signInGoogle, signOut, clearAll, sendResetCode, resetPassword]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
