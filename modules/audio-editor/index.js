import { requireOptionalNativeModule } from 'expo';

// The audio editor's native code (android/src/main/java/expo/modules/audioeditor). It's missing on
// the web, on iPhone, and in APKs built before the editor was added, so check EDITOR_SUPPORTED first.
const AudioEditor = requireOptionalNativeModule('AudioEditor');

export const EDITOR_SUPPORTED = !!AudioEditor;
export const EQ_BANDS = ['60 Hz', '230 Hz', '910 Hz', '3.6 kHz', '14 kHz'];
export default AudioEditor;
