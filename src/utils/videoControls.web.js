// Browser version of videoControls.js: a page can't change the screen's brightness or turn the
// screen, so "brightness" dims the picture with a dark layer and volume is the video's own.

export const DIM_WITH_OVERLAY = true;
let level = 1;

export async function getBrightness() { return level; }
export function setBrightness(v) { level = Math.max(0.15, Math.min(1, v)); }
export function restoreBrightness() { level = 1; }

export function getVolume(player) { return player?.volume ?? 1; }
export function setVolume(player, v) {
  const value = Math.max(0, Math.min(1, v));
  if (player) player.volume = value;
  return value;
}

export function landscape() {}
export function portrait() {}
export const CAN_ROTATE = false;
