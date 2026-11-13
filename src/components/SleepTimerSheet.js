import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { colors } from '../theme';
import { usePlayer } from '../context/PlayerContext';
import Sheet, { SheetItem } from './Sheet';

const OPTIONS = [5, 15, 30, 45, 60];

export default function SleepTimerSheet({ visible, onClose }) {
  const { sleepAt, sleepAfterTrack, setSleepTimer } = usePlayer();
  const active = !!sleepAt || sleepAfterTrack;
  const pick = (v) => { setSleepTimer(v); onClose(); };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>Sleep timer</Text>
      {active && (
        <Text style={styles.status}>
          {sleepAfterTrack
            ? 'Music will stop at the end of this song'
            : `Music will stop in ${Math.max(1, Math.round((sleepAt - Date.now()) / 60000))} min`}
        </Text>
      )}
      {OPTIONS.map((m) => (
        <SheetItem key={m} icon="moon-outline" label={`${m} minutes`} onPress={() => pick(m)} />
      ))}
      <SheetItem icon="musical-note-outline" label="End of track" onPress={() => pick('end')} />
      {active && <SheetItem icon="close-circle-outline" color={colors.danger} label="Turn off timer" onPress={() => pick(null)} />}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text, fontSize: 17, fontWeight: '800', paddingHorizontal: 20, paddingBottom: 4 },
  status: { color: colors.accent, paddingHorizontal: 20, paddingBottom: 8 },
});
