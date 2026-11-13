// Small differences between the phone app and the web version (VibeRoom in a browser).
// On the phone these do exactly what the app did before the web version existed.

import { Alert, Platform, ToastAndroid } from 'react-native';

export const IS_WEB = Platform.OS === 'web';

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

// A message with an OK button.
export function notify(title, message = '') {
  if (IS_WEB) {
    // eslint-disable-next-line no-alert
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

// Short message at the bottom of the screen ("Added to queue").
let webToastTimer = null;
function webToast(msg) {
  let el = document.getElementById('vr-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'vr-toast';
    Object.assign(el.style, {
      position: 'fixed', left: '50%', bottom: '120px', transform: 'translateX(-50%)', zIndex: 99999,
      background: '#2A2A2E', color: '#fff', padding: '10px 18px', borderRadius: '20px',
      font: '14px system-ui, sans-serif', boxShadow: '0 4px 16px rgba(0,0,0,.4)', transition: 'opacity .2s',
      pointerEvents: 'none', maxWidth: '80vw', textAlign: 'center',
    });
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(webToastTimer);
  webToastTimer = setTimeout(() => { el.style.opacity = '0'; }, 2000);
}

export function toast(msg) {
  if (Platform.OS === 'android') ToastAndroid.show(msg, ToastAndroid.SHORT);
  else if (IS_WEB) webToast(msg);
  else Alert.alert(msg);
}
