import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { keyStore } from '../utils/files';
import {
  checkSession, signInWithEmail, signOutSession, signUpWithEmail,
  requestPasswordReset, resetPasswordWithCode,
} from '../api/auth';
import { googleFlow, pendingGoogleReturn, resumeGoogle, forwardToApp } from '../utils/googleSignIn';
import { clearLibraryForSignOut } from './LibraryContext';
import { clearStats } from '../utils/stats';
import { diag } from '../utils/diag';

// The signed-in account. Signing in is required (App.js shows SignInScreen until then).
// The session string lives in secure storage (phone) / localStorage (web); the account's name
// and email are also kept so the app opens signed in without internet. The session is checked
// with the server in the background; if it was ended (signed out elsewhere, expired), the app
// signs out.

const SESSION_KEY = 'viberoom.session';
const USER_KEY = 'viberoom:user:v1';
const RESUME_KEY = 'tunely:player:v1'; // the player's saved queue (PlayerContext)
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // loading | signed-out | signed-in | forwarding (web page handing Google's answer to the phone app)
  const [status, setStatus] = useState(() => (forwardToApp() ? 'forwarding' : 'loading'));
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sessionRef = useRef(null); sessionRef.current = session;

  const signedIn = useCallback(async (data) => {
    diag('signedIn', `session=${!!data?.session} len=${data?.session?.length || 0} user=${!!data?.user?.id} msg=${data?.message || ''}`);
    if (!data?.session) {
      setError(data?.message || 'Sign-in didn\'t finish. Try again.');
      return;
    }
    try {
      await keyStore.set(SESSION_KEY, data.session);
    } catch (e) {
      diag('keyStore.set failed', e?.message);
      throw e;
    }
    diag('saved');
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(data.user)).catch(() => {});
    setSession(data.session);
    setUser(data.user);
    setError('');
    setStatus('signed-in');
  }, []);

  const clearAll = useCallback(async (why = '') => {
    diag('clearAll', typeof why === 'string' ? why : 'expired');
    await keyStore.remove(SESSION_KEY).catch(() => {});
    await AsyncStorage.multiRemove([USER_KEY, RESUME_KEY]).catch(() => {});
    await clearLibraryForSignOut();
    await clearStats();
    setSession(null);
    setUser(null);
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
      diag('verify failed', `${e.status} ${e.code} ${e.message}`);
      if (e.status === 401) clearAll('verify 401');
      // offline or server trouble: stay signed in
    }
  }, [clearAll]);

  // Start: restore the saved session, or else show the sign-in screen and finish a Google sign-in
  // we're coming back from (it shows as busy meanwhile, never as a blank screen).
  useEffect(() => {
    if (status === 'forwarding') return;
    (async () => {
      diag('start');
      const saved = await keyStore.get(SESSION_KEY).catch((e) => { diag('keyStore.get failed', e?.message); return null; });
      diag('saved session?', String(!!saved));
      if (saved) {
        let cached = null;
        try { cached = JSON.parse((await AsyncStorage.getItem(USER_KEY)) || 'null'); } catch (e) { /* none */ }
        setSession(saved);
        setUser(cached);
        setStatus('signed-in');
        return;
      }
      setStatus('signed-out');
      setBusy(true);
      try {
        const back = await pendingGoogleReturn();
        diag('pendingGoogleReturn', back ? 'got session' : 'nothing');
        if (back) await signedIn(back);
      } catch (e) {
        diag('start google error', `${e.status} ${e.code} ${e.message}`);
        setError(e.message || 'Google sign-in didn\'t finish. Try again.');
      } finally {
        setBusy(false);
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
      try {
        const back = await resumeGoogle(url);
        if (back) diag('resumeGoogle', `got session (url=${!!url})`);
        if (back) { setBusy(true); await signedIn(back); }
      } catch (e) {
        diag('resume error', `${e.status} ${e.code} ${e.message}`);
        setError(e.message);
      } finally {
        resuming.current = false;
        setBusy(false);
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
    try { await fn(); } catch (e) { diag('run error', `${e.status} ${e.code} ${e.message}`); setError(e.message || 'Sign-in failed. Try again.'); } finally { setBusy(false); }
  }, []);

  const signInEmail = useCallback((email, password) => run(async () => signedIn(await signInWithEmail(email, password))), [run, signedIn]);
  const signUpEmail = useCallback((email, password, name) => run(async () => signedIn(await signUpWithEmail(email, password, name))), [run, signedIn]);
  const signInGoogle = useCallback(() => run(async () => {
    diag('google tapped');
    const back = await googleFlow();
    diag('googleFlow done', back ? 'got session' : 'null');
    if (back) await signedIn(back);
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
    await clearAll('sign out');
    if (s) signOutSession(s);
  }, [clearAll]);

  useEffect(() => { diag('status', status); }, [status]);

  const value = useMemo(() => ({
    status, user, session, busy, error, setError,
    signInEmail, signUpEmail, signInGoogle, signOut, expired: clearAll, sendResetCode, resetPassword,
  }), [status, user, session, busy, error, signInEmail, signUpEmail, signInGoogle, signOut, clearAll, sendResetCode, resetPassword]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
