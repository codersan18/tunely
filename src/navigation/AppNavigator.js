import React from 'react';
import { View } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator, BottomTabBar } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme';
import HomeScreen from '../screens/HomeScreen';
import SearchScreen from '../screens/SearchScreen';
import LibraryScreen from '../screens/LibraryScreen';
import PlaylistScreen from '../screens/PlaylistScreen';
import PlayerScreen from '../screens/PlayerScreen';
import QueueScreen from '../screens/QueueScreen';
import AdminScreen from '../screens/AdminScreen';
import LocalMusicScreen from '../screens/LocalMusicScreen';
import SettingsScreen from '../screens/SettingsScreen';
import StatsScreen from '../screens/StatsScreen';
import RequestScreen from '../screens/RequestScreen';
import EditorScreen from '../screens/EditorScreen';
import EditsScreen from '../screens/EditsScreen';
import PickSongScreen from '../screens/PickSongScreen';
import MiniPlayer from '../components/MiniPlayer';
import SongLinkHandler from '../components/SongLinkHandler';

const Root = createNativeStackNavigator();
const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const theme = {
  ...DarkTheme,
  colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bg, primary: colors.accent, text: colors.text },
};

// Each tab gets its own stack so the Playlist screen keeps the tab bar + mini player visible.
const makeStack = (name, Component) => function TabStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
      <Stack.Screen name={name} component={Component} />
      <Stack.Screen name="Playlist" component={PlaylistScreen} />
      <Stack.Screen name="LocalMusic" component={LocalMusicScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Stats" component={StatsScreen} />
      <Stack.Screen name="Edits" component={EditsScreen} />
    </Stack.Navigator>
  );
};

const HomeStack = makeStack('HomeMain', HomeScreen);
const SearchStack = makeStack('SearchMain', SearchScreen);
const LibraryStack = makeStack('LibraryMain', LibraryScreen);

const icons = { Home: 'home', Search: 'search', Library: 'library' };

function Tabs({ navigation }) {
  return (
    <>
    <SongLinkHandler navigation={navigation} />
    <Tab.Navigator
      tabBar={(props) => (
        <View style={{ backgroundColor: 'transparent' }}>
          <MiniPlayer />
          <BottomTabBar {...props} />
        </View>
      )}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: 'rgba(14,14,16,0.97)', borderTopWidth: 0 },
        tabBarIcon: ({ focused, color, size }) => (
          <Ionicons name={focused ? icons[route.name] : `${icons[route.name]}-outline`} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Home" component={HomeStack} />
      <Tab.Screen name="Search" component={SearchStack} />
      <Tab.Screen name="Library" component={LibraryStack} options={{ title: 'Your Library' }} />
    </Tab.Navigator>
    </>
  );
}

export default function AppNavigator() {
  return (
    <NavigationContainer theme={theme}>
      <Root.Navigator screenOptions={{ headerShown: false }}>
        <Root.Screen name="Tabs" component={Tabs} />
        <Root.Screen
          name="Player"
          component={PlayerScreen}
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Root.Screen
          name="Admin"
          component={AdminScreen}
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Root.Screen
          name="Queue"
          component={QueueScreen}
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Root.Screen
          name="Editor"
          component={EditorScreen}
          options={{ presentation: 'modal', animation: 'slide_from_bottom', gestureEnabled: false }}
        />
        <Root.Screen
          name="PickSong"
          component={PickSongScreen}
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
        <Root.Screen
          name="Request"
          component={RequestScreen}
          options={{ presentation: 'modal', animation: 'slide_from_bottom' }}
        />
      </Root.Navigator>
    </NavigationContainer>
  );
}
