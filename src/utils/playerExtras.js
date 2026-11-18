// Equalizer and data saver for the player: the phone version (the browser version is
// playerExtras.web.js). Used by PlayerContext.
import AudioEditor from '../../modules/audio-editor';

// The equalizer needs an APK with the editor module and the patched expo-audio (audioSessionId).
export const EQ_AVAILABLE = !!AudioEditor?.setPlaybackEq;
export const DATA_SAVER_AVAILABLE = true;
export const PLAYLIST_OPTIONS = { updateInterval: 500 };

/** Android's equalizer on the player's audio session (modules/audio-editor, PlaybackEq.kt). */
export function applyEq(playlist, on, bands) {
  if (!EQ_AVAILABLE) return { supported: false, active: false };
  let session = 0;
  try { session = playlist.audioSessionId || 0; } catch (e) { /* older app build */ }
  if (!session) return { supported: false, active: false };
  try { return AudioEditor.setPlaybackEq(session, !!on, bands || []); } catch (e) { return { supported: false, active: false }; }
}

/** On mobile data, load only ~50 s ahead (patches/expo-audio+*.patch adds this switch). */
export function applyDataSaver(playlist, on, onMobileData) {
  try { playlist.dataSaver = !!(on && onMobileData); } catch (e) { /* older app build */ }
}

/** Called on every player status update (the browser version needs it; nothing to do here). */
export function onPlayerStatus() {}
