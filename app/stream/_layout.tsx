import { Stack } from 'expo-router';
import { useKeepAwake } from '@/hooks/useKeepAwake';

/**
 * Live Stream's own stack: S1's Settings and Diagnostics live here, so they
 * stay reachable on air (AGENTS §6) while leaving the mode does not. The
 * screen stays on for as long as the engine holds a session.
 */
export default function StreamLayout() {
  useKeepAwake();
  return <Stack screenOptions={{ headerShown: false, animation: 'none', gestureEnabled: false }} />;
}
