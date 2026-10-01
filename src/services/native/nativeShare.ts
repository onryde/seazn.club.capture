import { Share } from 'react-native';
import type { SharePort } from '@/services/devicePorts';

/**
 * React Native's own share sheet: no new dependency (D21). Resolves once the
 * sheet has opened, whether or not the operator then picks a target; rejects
 * only when it could not open.
 */
export function createNativeShare(): SharePort {
  return {
    share: async (text) => {
      await Share.share({ message: text });
    },
  };
}
