import React, { useMemo, useRef, useState } from 'react';
import { View, StyleSheet, PanResponder } from 'react-native';
import { colors } from '../theme';

// Two handles on one bar: the start and end of a part (seconds). `cut` colours the part between
// them as removed (cut out) instead of kept. onChange(start, end) while dragging; onSeek(t) tells
// where the dragged handle is, to show that frame.
export default function RangeSlider({ duration, start, end, onChange, onSeek, cut = false, minGap = 0.5 }) {
  const [width, setWidth] = useState(1);
  const latest = useRef({}); latest.current = { duration, start, end, onChange, onSeek, width, minGap };

  const handle = (which) => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { latest.current.from = which === 'start' ? latest.current.start : latest.current.end; },
    onPanResponderMove: (e, g) => {
      const L = latest.current;
      const t = Math.max(0, Math.min(L.duration, L.from + (g.dx / L.width) * L.duration));
      if (which === 'start') {
        const s = Math.min(t, L.end - L.minGap);
        L.onChange(Math.max(0, s), L.end);
        L.onSeek?.(Math.max(0, s));
      } else {
        const en = Math.max(t, L.start + L.minGap);
        L.onChange(L.start, Math.min(L.duration, en));
        L.onSeek?.(Math.min(L.duration, en));
      }
    },
  });
  const startPan = useMemo(() => handle('start'), []); // eslint-disable-line react-hooks/exhaustive-deps
  const endPan = useMemo(() => handle('end'), []); // eslint-disable-line react-hooks/exhaustive-deps

  const x = (t) => (duration ? (t / duration) * width : 0);
  return (
    <View style={styles.wrap} onLayout={(e) => setWidth(Math.max(1, e.nativeEvent.layout.width))}>
      <View style={[styles.track, { backgroundColor: cut ? colors.accent : colors.surfaceHigh }]} />
      <View style={[styles.part, { left: x(start), width: Math.max(2, x(end) - x(start)), backgroundColor: cut ? colors.danger : colors.accent }]} />
      <View {...startPan.panHandlers} hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
        style={[styles.knob, { left: x(start) - 14 }]} accessibilityLabel="Start" />
      <View {...endPan.panHandlers} hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
        style={[styles.knob, { left: x(end) - 14 }]} accessibilityLabel="End" />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 44, justifyContent: 'center', marginHorizontal: 14 },
  track: { height: 8, borderRadius: 4 },
  part: { position: 'absolute', height: 8, borderRadius: 4 },
  knob: { position: 'absolute', width: 28, height: 28, borderRadius: 14, backgroundColor: '#fff', borderWidth: 3, borderColor: colors.bg, top: 8 },
});
