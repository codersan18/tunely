import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LibraryProvider } from './src/context/LibraryContext';
import { PlayerProvider } from './src/context/PlayerContext';
import { CatalogProvider } from './src/context/CatalogContext';
import { LocalMusicProvider } from './src/context/LocalMusicContext';
import { SettingsProvider } from './src/context/SettingsContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import AppNavigator from './src/navigation/AppNavigator';
import SignInScreen from './src/screens/SignInScreen';
import LibrarySync from './src/components/LibrarySync';
import OpeningScreen from './src/components/OpeningScreen';
import WebFrame from './src/components/WebFrame';
import registerServiceWorker from './src/utils/serviceWorker';
import { checkForNewVersion } from './src/utils/newVersion';
import { colors } from './src/theme';

registerServiceWorker(); // web only; does nothing on the phone

// Signing in is required: the app itself only exists for a signed-in account. Its key is the
// account, so switching accounts starts everything fresh.
function Gate() {
  const { status, user } = useAuth();
  if (status === 'forwarding') {
    return (
      <View style={styles.center}>
        <Text style={styles.msg}>Signed in with Google. Returning to the VibeRoom app…</Text>
      </View>
    );
  }
  if (status === 'loading') return <View style={styles.blank} />;
  if (status !== 'signed-in') return <SignInScreen />;
  return (
    // Library (likes, playlists, downloads) wraps the player, because the
    // player asks the library whether a song is saved offline.
    <LibraryProvider key={user?.id || 'me'}>
      <LibrarySync />
      <CatalogProvider>
        <LocalMusicProvider>
          <SettingsProvider>
            <PlayerProvider>
              <AppNavigator />
            </PlayerProvider>
          </SettingsProvider>
        </LocalMusicProvider>
      </CatalogProvider>
    </LibraryProvider>
  );
}

export default function App() {
  const [opening, setOpening] = useState(true);
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
  blank: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 32 },
  msg: { color: colors.text, fontSize: 16, textAlign: 'center' },
});
