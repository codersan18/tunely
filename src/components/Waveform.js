import React, { useMemo, useRef, useState } from 'react';
import { View, PanResponder, StyleSheet } from 'react-native';
import { colors } from '../theme';

const HEIGHT = 130;
const BAR = 3;
const GAP = 1;
const GRAB = 36;     // how close (px) a touch must be to a handle to grab it
export const MIN_CUT_MS = 1000;

// The song's loudness as bars, with the cut [startMs, endMs] highlighted between two handles.
// Drag a handle to move that end, drag inside the cut to move the whole cut, or tap outside it to
// move the nearest end there.
export default function Waveform({ peaks, durationMs, startMs, endMs, onChange, onDragStart, playheadMs }) {
  const [width, setWidth] = useState(0);
  const latest = useRef({}); latest.current = { width, durationMs, startMs, endMs, onChange, onDragStart };
  const drag = useRef(null); // { mode: 'start' | 'end' | 'move', x0, start0, end0 }

  const bars = useMemo(() => {
    const n = Math.max(1, Math.floor(width / (BAR + GAP)));
    if (!peaks?.length || !width) return [];
    const top = Math.max(...peaks, 0.01);
    const out = [];
    for (let i = 0; i < n; i++) {
      const from = Math.floor((i / n) * peaks.length);
      const to = Math.max(from + 1, Math.floor(((i + 1) / n) * peaks.length));
      let m = 0;
      for (let j = from; j < to && j < peaks.length; j++) if (peaks[j] > m) m = peaks[j];
      out.push(Math.max(2, Math.sqrt(m / top) * (HEIGHT - 16)));
    }
    return out;
  }, [peaks, width]);

  const responder = useMemo(() => {
    const toMs = (x) => {
      const { width: w, durationMs: d } = latest.current;
      return w ? (Math.min(Math.max(x, 0), w) / w) * d : 0;
    };
    const apply = (x) => {
      const { durationMs: d, onChange: cb } = latest.current;
      const g = drag.current;
      if (!g) return;
      if (g.mode === 'start') cb(Math.round(Math.min(Math.max(toMs(x), 0), g.end0 - MIN_CUT_MS)), g.end0);
      else if (g.mode === 'end') cb(g.start0, Math.round(Math.max(Math.min(toMs(x), d), g.start0 + MIN_CUT_MS)));
      else {
        const len = g.end0 - g.start0;
        const s = Math.round(Math.min(Math.max(g.start0 + toMs(x) - toMs(g.x0), 0), d - len));
        cb(s, s + len);
      }
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const { width: w, durationMs: d, startMs: s, endMs: en, onDragStart: ds } = latest.current;
        if (!w || !d) return;
        const x = e.nativeEvent.locationX;
        const xs = (s / d) * w;
        const xe = (en / d) * w;
        const ds0 = Math.abs(x - xs);
        const de0 = Math.abs(x - xe);
        let mode;
        if (Math.min(ds0, de0) <= GRAB) mode = ds0 < de0 ? 'start' : 'end';
        else if (x > xs && x < xe) mode = 'move';
        else mode = x < xs ? 'start' : 'end';
        drag.current = { mode, x0: x, start0: s, end0: en };
        ds?.();
        if (mode !== 'move') apply(x);
      },
      onPanResponderMove: (e, g) => drag.current && apply(drag.current.x0 + g.dx),
      onPanResponderRelease: () => { drag.current = null; },
      onPanResponderTerminate: () => { drag.current = null; },
    });
  }, []);

  const x = (ms) => (durationMs ? (ms / durationMs) * width : 0);
  const xs = x(startMs);
  const xe = x(endMs);

  return (
    <View style={styles.box} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} {...responder.panHandlers}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <View style={styles.bars}>
          {bars.map((h, i) => {
            const mid = i * (BAR + GAP) + BAR / 2;
            const inside = mid >= xs && mid <= xe;
            return <View key={i} style={[styles.bar, { height: h, backgroundColor: inside ? colors.accent : colors.textDim }]} />;
          })}
        </View>
        <View style={[styles.shade, { left: 0, width: xs }]} />
        <View style={[styles.shade, { left: xe, right: 0 }]} />
        <Handle x={xs} />
        <Handle x={xe} />
        {playheadMs != null && <View style={[styles.playhead, { left: x(playheadMs) - 1 }]} />}
      </View>
    </View>
  );
}

function Handle({ x }) {
  return (
    <View style={[styles.handle, { left: x - 1 }]}>
      <View style={styles.knob} />
      <View style={[styles.knob, { top: undefined, bottom: -6 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { height: HEIGHT, marginHorizontal: 9 },
  bars: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: GAP },
  bar: { width: BAR, borderRadius: 1.5 },
  shade: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(14,14,16,0.45)' },
  handle: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.text },
  knob: { position: 'absolute', top: -6, left: -7, width: 16, height: 16, borderRadius: 8, backgroundColor: colors.text },
  playhead: { position: 'absolute', top: 0, bottom: 0, width: 2, backgroundColor: colors.danger },
});
