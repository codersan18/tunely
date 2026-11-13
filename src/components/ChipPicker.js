import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors } from '../theme';

// Pick one value from a list of chips. Tap the selected chip again to clear it.
// A saved value that isn't in the list still shows (as an extra chip).
export default function ChipPicker({ label, options, value, onChange, disabled }) {
  const all = value && !options.some((o) => o.toLowerCase() === value.toLowerCase()) ? [...options, value] : options;
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.wrap}>
        {all.map((o) => {
          const on = !!value && o.toLowerCase() === value.toLowerCase();
          return (
            <Pressable
              key={o}
              disabled={disabled}
              onPress={() => onChange(on ? '' : o)}
              style={[styles.chip, on && styles.chipOn, disabled && !on && { opacity: 0.5 }]}
            >
              <Text style={[styles.text, on && { color: colors.bg }]}>{o}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: colors.textMuted, fontSize: 12 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 14, borderWidth: 1, borderColor: colors.textDim, paddingHorizontal: 10, paddingVertical: 5 },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  text: { color: colors.text, fontSize: 12, fontWeight: '600' },
});
