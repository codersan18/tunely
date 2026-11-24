// The video player's phone controls (videoControls.web.js is the browser version): the screen's
// brightness (this app only, back to normal when the player closes), the phone's media volume
// (like MX Player), and turning the screen for landscape videos.
import * as Brightness from 'expo-brightness';
import * as ScreenOrientation from 'expo-screen-orientation';
import AudioEditor, { VIDEO_TOOLS_SUPPORTED } from '../../modules/audio-editor';

export const DIM_WITH_OVERLAY = false; // the phone changes the real brightness

export async function getBrightness() {
  try { return await Brightness.getBrightnessAsync(); } catch (e) { return 0.5; }
}
export function setBrightness(v) {
  Brightness.setBrightnessAsync(Math.max(0.01, Math.min(1, v))).catch(() => {});
}
export function restoreBrightness() {
  Brightness.restoreSystemBrightnessAsync().catch(() => {});
}

export function getVolume(player) {
  if (VIDEO_TOOLS_SUPPORTED) { try { return AudioEditor.getVolume(); } catch (e) { /* fall back */ } }
  return player?.volume ?? 1;
}
export function setVolume(player, v) {
  const value = Math.max(0, Math.min(1, v));
  if (VIDEO_TOOLS_SUPPORTED) { try { return AudioEditor.setVolume(value); } catch (e) { /* fall back */ } }
  if (player) player.volume = value;
  return value;
}

export function landscape() { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {}); }
export function portrait() { ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => {}); }
export const CAN_ROTATE = true;
