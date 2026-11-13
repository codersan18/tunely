import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LibraryProvider } from './src/context/LibraryContext';
import { PlayerProvider } from './src/context/PlayerContext';
import { CatalogProvider } from './src/context/CatalogContext';
import AppNavigator from './src/navigation/AppNavigator';
import OpeningScreen from './src/components/OpeningScreen';
import WebFrame from './src/components/WebFrame';

export default function App() {
  const [opening, setOpening] = useState(true);
  return (
    <SafeAreaProvider>
      <WebFrame>
      {/* Library (likes, playlists, downloads) wraps the player, because the
          player asks the library whether a song is saved offline. */}
      <LibraryProvider>
        <CatalogProvider>
          <PlayerProvider>
            <AppNavigator />
            <StatusBar style="light" />
          </PlayerProvider>
        </CatalogProvider>
      </LibraryProvider>
      {/* The app loads underneath while the opening screen plays. */}
      {opening && <OpeningScreen onDone={() => setOpening(false)} />}
      </WebFrame>
    </SafeAreaProvider>
  );
}
