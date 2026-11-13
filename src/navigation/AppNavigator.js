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
import MiniPlayer from '../components/MiniPlayer';

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
    </Stack.Navigator>
  );
};

const HomeStack = makeStack('HomeMain', HomeScreen);
const SearchStack = makeStack('SearchMain', SearchScreen);
const LibraryStack = makeStack('LibraryMain', LibraryScreen);

const icons = { Home: 'home', Search: 'search', Library: 'library' };

function Tabs() {
  return (
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
      </Root.Navigator>
    </NavigationContainer>
  );
}
