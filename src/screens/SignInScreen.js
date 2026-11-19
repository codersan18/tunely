import React, { useState } from 'react';
import {
  View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import { useAuth } from '../context/AuthContext';
import LoadingScreen from '../components/LoadingScreen';

// Shown until the person signs in (App.js). Google, or email + password, and "Forgot password?":
// a 6-digit code by email, then the code and a new password.
const TITLES = {
  'sign-in': 'Welcome to VibeRoom',
  'sign-up': 'Create your account',
  forgot: 'Forgot your password?',
  reset: 'Enter the code',
};

export default function SignInScreen() {
  const { busy, error, setError, signInEmail, signUpEmail, signInGoogle, sendResetCode, resetPassword, googleBusy, cancelGoogle } = useAuth();
  const [mode, setMode] = useState('sign-in'); // sign-in | sign-up | forgot | reset
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState('');
  const creating = mode === 'sign-up';
  const newPassword = creating || mode === 'reset';

  const go = (m) => { setMode(m); setError(''); setNotice(''); setPassword(''); setCode(''); };

  const sendCode = async () => {
    if (!email.trim()) { setError('Enter your email.'); return; }
    if (await sendResetCode(email.trim())) {
      setMode('reset');
      setNotice(`If ${email.trim()} has a VibeRoom account, a 6-digit code is on its way. It can take a minute; check spam too.`);
    }
  };

  const submit = () => {
    if (busy) return;
    if (mode === 'forgot') { sendCode(); return; }
    if (mode === 'reset') {
      if (code.replace(/\s/g, '').length < 6) { setError('Enter the 6-digit code from the email.'); return; }
      if (password.length < 8) { setError('Use a new password of at least 8 characters.'); return; }
      resetPassword(email.trim(), code, password);
      return;
    }
    if (!email.trim() || !password) { setError('Enter your email and password.'); return; }
    if (creating && password.length < 8) { setError('Use a password of at least 8 characters.'); return; }
    if (creating) signUpEmail(email.trim(), password, name.trim());
    else signInEmail(email.trim(), password);
  };

  const sub = {
    'sign-in': 'Your likes, playlists and listening stats, on every phone and on the web.',
    'sign-up': 'Your likes, playlists and listening stats, on every phone and on the web.',
    forgot: 'Enter your account\'s email. We\'ll send you a 6-digit code to set a new password.',
    reset: `Type the code sent to ${email.trim()} and choose a new password.`,
  }[mode];

  // Signing in with Google (or finishing it after coming back): the same plain loading screen as
  // the profiles loading after it, so nothing that looks like the login page shows in between.
  if (googleBusy) return <LoadingScreen message="Signing you in…" onCancel={Platform.OS === 'web' ? null : cancelGoogle} />;

  return (
    <LinearGradient colors={['#123528', colors.bg]} locations={[0, 0.55]} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <View style={styles.logo}>
              <Ionicons name={mode === 'forgot' || mode === 'reset' ? 'key' : 'musical-notes'} size={36} color={colors.bg} />
            </View>
            <Text style={styles.h1}>{TITLES[mode]}</Text>
            <Text style={styles.sub}>{sub}</Text>

            {(mode === 'sign-in' || creating) && (
              <>
                <Pressable onPress={signInGoogle} disabled={busy} style={({ pressed }) => [styles.google, (pressed || busy) && { opacity: 0.7 }]}
                  accessibilityLabel="Continue with Google">
                  <Ionicons name="logo-google" size={20} color="#1A1A1A" />
                  <Text style={styles.googleText}>Continue with Google</Text>
                </Pressable>
                <View style={styles.orRow}>
                  <View style={styles.line} />
                  <Text style={styles.or}>or with email</Text>
                  <View style={styles.line} />
                </View>
              </>
            )}

            {creating && (
              <TextInput value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={colors.textDim}
                style={styles.input} autoComplete="name" textContentType="name" maxLength={80} editable={!busy} />
            )}
            {mode !== 'reset' && (
              <TextInput value={email} onChangeText={setEmail} placeholder="Email" placeholderTextColor={colors.textDim}
                style={styles.input} autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
                autoComplete="email" textContentType="emailAddress" editable={!busy}
                onSubmitEditing={mode === 'forgot' ? submit : undefined} returnKeyType={mode === 'forgot' ? 'send' : 'next'} />
            )}
            {mode === 'reset' && (
              <TextInput value={code} onChangeText={(t) => setCode(t.replace(/[^0-9]/g, '').slice(0, 6))} placeholder="6-digit code"
                placeholderTextColor={colors.textDim} style={[styles.input, styles.code]} keyboardType="number-pad"
                autoComplete="one-time-code" textContentType="oneTimeCode" maxLength={6} editable={!busy} />
            )}
            {mode !== 'forgot' && (
              <View>
                <TextInput value={password} onChangeText={setPassword}
                  placeholder={mode === 'reset' ? 'New password (at least 8 characters)' : creating ? 'Password (at least 8 characters)' : 'Password'}
                  placeholderTextColor={colors.textDim} style={[styles.input, { paddingRight: 48 }]} secureTextEntry={!showPassword}
                  autoCapitalize="none" autoCorrect={false} autoComplete={newPassword ? 'new-password' : 'current-password'}
                  textContentType={newPassword ? 'newPassword' : 'password'} editable={!busy} onSubmitEditing={submit} returnKeyType="go" />
                <Pressable onPress={() => setShowPassword((v) => !v)} style={styles.eye} hitSlop={10}
                  accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}>
                  <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textMuted} />
                </Pressable>
              </View>
            )}

            {mode === 'sign-in' && (
              <Pressable onPress={() => go('forgot')} disabled={busy} hitSlop={8} style={styles.forgot}>
                <Text style={styles.link}>Forgot password?</Text>
              </Pressable>
            )}

            {!!notice && !error && <Text style={styles.notice}>{notice}</Text>}
            {!!error && <Text style={styles.error}>{error}</Text>}

            <Pressable onPress={submit} disabled={busy} style={({ pressed }) => [styles.primary, (pressed || busy) && { opacity: 0.7 }]}>
              {busy ? <ActivityIndicator color={colors.bg} /> : (
                <Text style={styles.primaryText}>
                  {{ 'sign-in': 'Sign in', 'sign-up': 'Create account', forgot: 'Send code', reset: 'Set new password' }[mode]}
                </Text>
              )}
            </Pressable>

            {mode === 'reset' && (
              <Pressable onPress={sendCode} disabled={busy} hitSlop={8} style={styles.switch}>
                <Text style={styles.switchText}>Didn{'\''}t get it? <Text style={styles.linkStrong}>Send a new code</Text></Text>
              </Pressable>
            )}

            {(mode === 'sign-in' || creating) ? (
              <Pressable onPress={() => go(creating ? 'sign-in' : 'sign-up')} disabled={busy} hitSlop={8} style={styles.switch}>
                <Text style={styles.switchText}>
                  {creating ? 'Already have an account? ' : 'New to VibeRoom? '}
                  <Text style={styles.linkStrong}>{creating ? 'Sign in' : 'Create an account'}</Text>
                </Text>
              </Pressable>
            ) : (
              <Pressable onPress={() => go('sign-in')} disabled={busy} hitSlop={8} style={styles.switch}>
                <Text style={styles.switchText}><Text style={styles.linkStrong}>Back to sign in</Text></Text>
              </Pressable>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  body: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 12, maxWidth: 440, width: '100%', alignSelf: 'center' },
  logo: { width: 72, height: 72, borderRadius: 20, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 8 },
  h1: { color: colors.text, fontSize: 26, fontWeight: '800', textAlign: 'center' },
  sub: { color: colors.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 12 },
  google: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: '#FFFFFF', borderRadius: 26, paddingVertical: 14 },
  googleText: { color: '#1A1A1A', fontSize: 16, fontWeight: '700' },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 6 },
  line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.textDim },
  or: { color: colors.textMuted, fontSize: 13 },
  input: { backgroundColor: colors.surfaceHigh, color: colors.text, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15 },
  code: { fontSize: 22, letterSpacing: 8, textAlign: 'center', fontWeight: '700' },
  eye: { position: 'absolute', right: 14, top: 0, bottom: 0, justifyContent: 'center' },
  forgot: { alignSelf: 'flex-end' },
  link: { color: colors.accent, fontSize: 13, fontWeight: '700' },
  linkStrong: { color: colors.accent, fontWeight: '800' },
  notice: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  primary: { backgroundColor: colors.accent, borderRadius: 26, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  primaryText: { color: colors.bg, fontSize: 16, fontWeight: '800' },
  switch: { alignSelf: 'center', paddingVertical: 8 },
  switchText: { color: colors.textMuted, fontSize: 14 },
});
