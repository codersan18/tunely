// Accounts and sync: talks to the backend (backend/index.mjs, "Accounts" section). The backend
// signs in with Neon Auth for us and returns a `session` string, which the app keeps in secure
// storage and sends as the "x-session" header.
import { API_URL } from './catalog';

export class AuthError extends Error {
  constructor(message, { status = 0, code = '' } = {}) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function post(path, body, headers = {}) {
  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body || {}),
    });
  } catch (e) {
    throw new AuthError('No internet connection. Check it and try again.', { code: 'offline' });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthError(data.message || `Something went wrong (${res.status})`, { status: res.status, code: data.error });
  return data;
}

export const signUpWithEmail = (email, password, name) => post('/auth/sign-up', { email, password, name });
export const signInWithEmail = (email, password) => post('/auth/sign-in', { email, password });
export const startGoogle = (callbackURL) => post('/auth/google', { callbackURL });
export const finishGoogle = (verifier, challenge) => post('/auth/google/finish', { verifier, challenge });
export const checkSession = (session) => post('/auth/session', { session });
export const signOutSession = (session) => post('/auth/sign-out', { session }).catch(() => {});
export const syncLibrary = (session, body) => post('/me/library', body, { 'x-session': session });
