import * as SplashScreen from 'expo-splash-screen';
import type { SplashPort } from '@/services/devicePorts';

export function createNativeSplash(): SplashPort {
  return { hide: () => SplashScreen.hide() };
}
