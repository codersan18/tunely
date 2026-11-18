import React, { useMemo, useRef, useState } from 'react';
import { View, PanResponder, StyleSheet } from 'react-native';
import { colors } from '../theme';

// A simple horizontal slider: drag or tap anywhere on it. `center` draws the fill from the middle
// (for values that go below and above zero, like decibels).
export default function Slider({ value, min, max, step = 1, onChange, center = false, style }) {
  const [width, setWidth] = useState(0);
  const latest = useRef({}); latest.current = { width, value, min, max, step, onChange };
  const startX = useRef(0);

  const responder = useMemo(() => {
    const set = (x) => {
      const { width: w, min: lo, max: hi, step: st, onChange: cb, value: v } = latest.current;
      if (!w) return;
      const raw = lo + (Math.min(Math.max(x, 0), w) / w) * (hi - lo);
      const next = Math.round(raw / st) * st;
      if (next !== v) cb(Number(next.toFixed(3)));
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => { startX.current = e.nativeEvent.locationX; set(startX.current); },
      onPanResponderMove: (e, g) => set(startX.current + g.dx),
    });
  }, []);

  const frac = (Math.min(Math.max(value, min), max) - min) / (max - min || 1);
  const zero = center ? (0 - min) / (max - min) : 0;
  const left = Math.min(frac, zero) * width;
  const fill = Math.abs(frac - zero) * width;

  return (
    <View style={[styles.box, style]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} {...responder.panHandlers}>
      <View pointerEvents="none" style={styles.track}>
        <View style={[styles.fill, { left, width: fill }]} />
        {center && <View style={[styles.zero, { left: zero * width - 1 }]} />}
      </View>
      <View pointerEvents="none" style={[styles.thumb, { left: frac * width - 9 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { height: 32, justifyContent: 'center' },
  track: { height: 4, borderRadius: 2, backgroundColor: colors.surfaceHigh },
  fill: { position: 'absolute', top: 0, bottom: 0, backgroundColor: colors.accent, borderRadius: 2 },
  zero: { position: 'absolute', top: -4, width: 2, height: 12, backgroundColor: colors.textDim },
  thumb: { position: 'absolute', width: 18, height: 18, borderRadius: 9, backgroundColor: colors.text },
});
