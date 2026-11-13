// Small differences between the phone app and the web version (VibeRoom in a browser).
// On the phone every value here is the same as before the web version existed.

import { Alert, Platform } from 'react-native';

export const IS_WEB = Platform.OS === 'web';

// Browsers can't keep songs for offline listening like the phone can, and uploading songs
// stays in the phone app, so both are hidden on the web.
export const CAN_DOWNLOAD = !IS_WEB;
export const CAN_MANAGE_SONGS = !IS_WEB;

// "Are you sure?" dialog. React Native's Alert does nothing in a browser, so use confirm() there.
export function confirmAction(title, message, okText, onOk) {
  if (IS_WEB) {
    // eslint-disable-next-line no-alert
    if (window.confirm(`${title}\n\n${message}`)) onOk();
    return;
  }
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: okText, style: 'destructive', onPress: onOk },
  ]);
}
