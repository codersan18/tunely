// Browser version of phoneSounds.js. A website can't change a phone's ringtone, alarm or
// notification sound, so the editor offers to download the file instead.
import { toast } from './platform';

export const SOUND_KINDS = {
  download: { label: 'Download', set: 'Download the file', icon: 'download-outline', done: 'Downloaded' },
};
export const SAVE_OPTIONS = [
  { kind: 'download', set: 'Save and download', icon: 'download-outline' },
  { kind: 'music', set: 'Save in this browser', icon: 'save-outline' },
];
export const SAVE_NOTE = 'Saved in this browser as a .wav file (Ringtones & edits). To use it as a ringtone, download it, copy it to your phone and choose it in the phone\'s sound settings, or open VibeRoom on the phone.';

/** Downloads the sound (on the phone, this sets it as the ringtone, alarm or notification sound). */
export function setPhoneSound(uri, kind, onDone, name) {
  try {
    const a = document.createElement('a');
    a.href = uri;
    a.download = `${(name || 'VibeRoom sound').replace(/[\\/:*?"<>|]/g, ' ').trim()}.wav`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    toast('Downloaded');
    onDone?.();
  } catch (e) {
    toast("Couldn't download it");
  }
}
