// Equalizer presets (dB for the 60 Hz, 230 Hz, 910 Hz, 3.6 kHz and 14 kHz bands), shared by the
// audio editor and the equalizer for songs as they play.
export const FLAT = [0, 0, 0, 0, 0];
export const EQ_PRESETS = [
  { name: 'Flat', eq: FLAT },
  { name: 'Bass boost', eq: [8, 4, 0, 0, 0] },
  { name: 'Treble boost', eq: [0, 0, 0, 4, 7] },
  { name: 'Vocal', eq: [-3, -1, 4, 4, 1] },
  { name: 'Rock', eq: [5, 2, -2, 3, 5] },
  { name: 'Pop', eq: [-1, 2, 4, 2, -1] },
  { name: 'Classical', eq: [4, 2, -1, 2, 4] },
];

export const presetName = (eq) => EQ_PRESETS.find((p) => p.eq.every((v, i) => v === eq?.[i]))?.name || 'Custom';
