import { Linking } from 'react-native';
import type { LinkPort } from '@/services/linkPort';

/**
 * React Native's own `Linking`: no new dependency. `openURL` rejects when no app can open the URL, which the pad says
 * on its banner. The URL may hold a scoring link's token, so nothing here logs it, and an error is rethrown as a plain
 * one that does not carry it.
 */
export function createNativeLink(): LinkPort {
  return {
    openUrl: async (url) => {
      try {
        await Linking.openURL(url);
      } catch {
        throw new Error('no app can open this link');
      }
    },
  };
}
