import { BackHandler } from 'react-native';
import type { BackPort } from '@/services/devicePorts';

export function createNativeBack(): BackPort {
  return {
    subscribe: (onBack) => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => subscription.remove();
    },
  };
}
