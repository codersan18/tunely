import { Alert, AppState } from 'react-native';
import AudioEditor, { EDITOR_SUPPORTED } from '../../modules/audio-editor';
import { toast } from './platform';

// What the editor's Save button offers, and the note under it.
export const SAVE_NOTE = 'Saved on this phone as an .m4a file in the "VibeRoom" folder, inside Ringtones, Alarms, Notifications or Music.';
export const SOUND_KINDS = {
  ringtone: { label: 'Ringtone', set: 'Set as ringtone', icon: 'call-outline', done: 'Ringtone set' },
  alarm: { label: 'Alarm', set: 'Set as alarm sound', icon: 'alarm-outline', done: 'Alarm sound set' },
  notification: { label: 'Notification', set: 'Set as notification / SMS sound', icon: 'chatbubble-ellipses-outline', done: 'Notification and SMS sound set' },
};
export const SAVE_OPTIONS = [
  ...Object.entries(SOUND_KINDS).map(([kind, o]) => ({ kind, ...o })),
  { kind: 'music', set: 'Just save it', icon: 'save-outline' },
];

// Android lets an app change the phone's sounds only after the person turns on "Modify system
// settings" for it. If that's off, explain, open the setting, and finish the job when they come back.
let waiting = null; // { uri, kind, onDone }
if (EDITOR_SUPPORTED) {
  AppState.addEventListener('change', (s) => {
    if (s !== 'active' || !waiting) return;
    const job = waiting;
    waiting = null;
    if (!AudioEditor.canWriteSettings()) {
      toast('Not allowed, so nothing changed. Your sound is saved: set it any time from Ringtones & edits.');
      return;
    }
    apply(job);
  });
}

async function apply({ uri, kind, onDone }) {
  try {
    await AudioEditor.setAsDefault(uri, kind);
    toast(SOUND_KINDS[kind].done);
    onDone?.();
  } catch (e) {
    toast(`Couldn't set it: ${e.message}`);
  }
}

/** Makes `uri` the phone's ringtone / alarm / notification sound. (`name` is used on the web.) */
export function setPhoneSound(uri, kind, onDone, name) { // eslint-disable-line no-unused-vars
  if (!EDITOR_SUPPORTED) return;
  if (AudioEditor.canWriteSettings()) { apply({ uri, kind, onDone }); return; }
  Alert.alert(
    'One more step',
    `To change your ${SOUND_KINDS[kind].label.toLowerCase()} sound, Android needs you to allow VibeRoom to "modify system settings".\n\nTurn it on in the next screen, then come back.`,
    [
      { text: 'Not now', style: 'cancel' },
      {
        text: 'Open settings',
        onPress: () => {
          waiting = { uri, kind, onDone };
          try { AudioEditor.openWriteSettings(); } catch (e) { waiting = null; toast("Couldn't open settings"); }
        },
      },
    ],
  );
}
