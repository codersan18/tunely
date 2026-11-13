// Phone version of the file helpers used by the upload screen.
// The browser version is files.web.js (Expo picks it automatically on the web).

import * as SecureStore from 'expo-secure-store';
import { File } from 'expo-file-system';
import { readTags } from './readTags';

// The admin password, kept in the phone's secure storage.
export const keyStore = {
  get: (name) => SecureStore.getItemAsync(name),
  set: (name, value) => SecureStore.setItemAsync(name, value),
  remove: (name) => SecureStore.deleteItemAsync(name),
};

// SHA-256 of a picked file (hex), used to spot songs that are already in the library.
export const fileHash = (asset) => new File(asset.uri).digest('SHA-256');

// Title, artists, album, cover... stored inside the file. null if there are none.
export const fileTags = (asset) => readTags(asset.uri);

// PUT a picked file (song or cover) to a signed storage URL. Returns the HTTP status.
export async function uploadFile(source, url, contentType) {
  const res = await new File(source.uri).upload(url, { httpMethod: 'PUT', headers: { 'content-type': contentType } });
  return res.status;
}
