import * as SecureStore from 'expo-secure-store';
import type { KeyValueStore } from '@/services/KeyValueStore';

/** Keystore on Android, Keychain on iOS. Values here are at most ~0.5 KB (spec §4). */
export function createSecureKeyValueStore(): KeyValueStore {
  return {
    get: (key) => SecureStore.getItemAsync(key),
    set: (key, value) => SecureStore.setItemAsync(key, value),
    delete: (key) => SecureStore.deleteItemAsync(key),
  };
}
