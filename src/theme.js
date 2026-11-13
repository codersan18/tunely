export const colors = {
  bg: '#0E0E10',
  surface: '#1A1A1E',
  surfaceHigh: '#26262C',
  text: '#FFFFFF',
  textMuted: '#A7A7B0',
  textDim: '#6B6B75',
  accent: '#2EE6A6', // Tunely mint
  accentDark: '#0B5C44',
  danger: '#FF5C7A',
};

export const formatTime = (seconds = 0) => {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
};
