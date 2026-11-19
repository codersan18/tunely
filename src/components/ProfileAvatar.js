import React from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { avatarById, GOOGLE_AVATAR } from '../utils/avatars';

// A profile's picture: a rounded tile with its character (utils/avatars.js), or the Google photo.
export default function ProfileAvatar({ avatar, size = 96, photo = null, name = '' }) {
  const radius = Math.round(size * 0.18);
  if (avatar === GOOGLE_AVATAR) {
    if (photo) return <Image source={{ uri: photo }} style={{ width: size, height: size, borderRadius: radius }} />;
    return (
      <View style={[styles.center, { width: size, height: size, borderRadius: radius, backgroundColor: '#1ED760' }]}>
        <Text style={{ color: '#121212', fontSize: size * 0.45, fontWeight: '800' }}>{(name.trim()[0] || '?').toUpperCase()}</Text>
      </View>
    );
  }
  const a = avatarById(avatar);
  return (
    <LinearGradient colors={a.colors} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[styles.center, { width: size, height: size, borderRadius: radius }]}>
      <Text style={{ fontSize: size * 0.56, lineHeight: size * 0.72, textAlign: 'center' }} allowFontScaling={false}>{a.emoji}</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
