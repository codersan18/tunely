import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LibraryProvider } from './src/context/LibraryContext';
import { PlayerProvider } from './src/context/PlayerContext';
import { CatalogProvider } from './src/context/CatalogContext';
import { LocalMusicProvider } from './src/context/LocalMusicContext';
import { SettingsProvider } from './src/context/SettingsContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import { ProfilesProvider, useProfiles } from './src/context/ProfilesContext';
import ProfilePickerScreen from './src/screens/ProfilePickerScreen';
import AppNavigator from './src/navigation/AppNavigator';
import SignInScreen from './src/screens/SignInScreen';
import LibrarySync from './src/components/LibrarySync';
import OpeningScreen from './src/components/OpeningScreen';
import WebFrame from './src/components/WebFrame';
import registerServiceWorker from './src/utils/serviceWorker';
import { checkForNewVersion } from './src/utils/newVersion';
import { appReturnUrl, isGoogleReturn } from './src/utils/googleSignIn';
import LoadingScreen from './src/components/LoadingScreen';
import StartCurtain from './src/components/StartCurtain';
import { colors } from './src/theme';

registerServiceWorker(); // web only; does nothing on the phone

// Signing in is required: the app itself only exists for a signed-in account. Its key is the
// account, so switching accounts starts everything fresh.
function Gate() {
  const { status, user } = useAuth();
  if (status === 'forwarding') {
    return (
      <View style={styles.center}>
        <Text style={styles.msg}>Signed in with Google. Go back to the VibeRoom app to continue.</Text>
        <Pressable onPress={() => { window.location.href = appReturnUrl(); }} accessibilityRole="button"
          style={({ pressed }) => [styles.open, pressed && { opacity: 0.7 }]}>
          <Text style={styles.openText}>Open VibeRoom</Text>
        </Pressable>
      </View>
    );
  }
  if (status === 'loading') return <LoadingScreen message={isGoogleReturn() ? 'Signing you in…' : ''} />;
  if (status !== 'signed-in') return <SignInScreen />;
  return (
    <ProfilesProvider key={user?.id || 'me'}>
      <ProfileGate />
    </ProfilesProvider>
  );
}

// Like Netflix: "Who's listening?" first when the account has more than one profile. Everything
// below is keyed by the profile, so switching profiles starts its own library, stats and queue.
function ProfileGate() {
  const { user, justSignedIn } = useAuth();
  const { profile, autoPicking } = useProfiles();
  if (!profile && autoPicking) return <LoadingScreen message={justSignedIn ? 'Signing you in…' : ''} />; // one profile: going straight in
  if (!profile) return <ProfilePickerScreen />;
  return (
    // Library (likes, playlists, downloads) wraps the player, because the
    // player asks the library whether a song is saved offline.
    <LibraryProvider key={`${user?.id || 'me'}:${profile.id}`}>
      <LibrarySync />
      <CatalogProvider>
        <LocalMusicProvider>
          <SettingsProvider>
            <PlayerProvider>
              <AppNavigator />
              {/* Home appears whole: the loading screen until it has its songs and covers. */}
              <StartCurtain />
            </PlayerProvider>
          </SettingsProvider>
        </LocalMusicProvider>
      </CatalogProvider>
    </LibraryProvider>
  );
}

export default function App() {
  // No opening animation on the pages that come back from Google: signing in carries straight on.
  const [opening, setOpening] = useState(() => !appReturnUrl() && !isGoogleReturn());
  // Once the opening screen is gone, see whether a newer APK has been released.
  useEffect(() => { if (!opening) checkForNewVersion(); }, [opening]);
  return (
    <SafeAreaProvider>
      <WebFrame>
        <AuthProvider>
          <Gate />
        </AuthProvider>
        <StatusBar style="light" />
        {/* The app loads underneath while the opening screen plays. */}
        {opening && <OpeningScreen onDone={() => setOpening(false)} />}
      </WebFrame>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 32 },
  msg: { color: colors.text, fontSize: 16, textAlign: 'center', lineHeight: 22 },
  open: { marginTop: 24, backgroundColor: colors.accent, borderRadius: 26, paddingVertical: 14, paddingHorizontal: 36 },
  openText: { color: colors.bg, fontSize: 16, fontWeight: '800' },
});
