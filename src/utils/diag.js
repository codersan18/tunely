// TEMPORARY: reports the steps of signing in on the phone to the backend (POST /diag), to find
// why Google sign-in on a phone ends back on the sign-in screen. No passwords, sessions or codes
// are sent: only step names and short notes. Remove with the /diag route once fixed.
import { Platform } from 'react-native';
import { API_URL } from '../api/catalog';

const RUN = Math.random().toString(36).slice(2, 10); // one id per app start
let n = 0;

export function diag(step, info = '') {
  if (Platform.OS === 'web') return;
  const body = JSON.stringify({ run: RUN, n: n++, step: String(step).slice(0, 60), info: String(info ?? '').slice(0, 300) });
  fetch(`${API_URL}/diag`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }).catch(() => {});
}
