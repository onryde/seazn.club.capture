import { Linking } from 'react-native';
import type { LinkPort } from '@/services/linkPort';

/** Only an https URL with a host is handed over. */
const HTTPS_URL = /^https:\/\/[^\s/]+/;

/**
 * React Native's own `Linking`: no new dependency. `openURL` rejects when no app can open the URL, which the pad says
 * on its banner. The URL may hold a scoring link's token, so nothing here logs it, and an error is rethrown as a plain
 * one that does not carry it. Only an https URL is handed over: a scheme the phone would act on (an intent, a store
 * scheme, a file) is refused here, whoever built the URL.
 */
export function createNativeLink(): LinkPort {
  return {
    openUrl: async (url) => {
      if (!HTTPS_URL.test(url)) throw new Error('no app can open this link');
      try {
        await Linking.openURL(url);
      } catch {
        throw new Error('no app can open this link');
      }
    },
  };
}
