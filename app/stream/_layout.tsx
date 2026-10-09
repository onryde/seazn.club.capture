import { Stack } from 'expo-router';
import { useKeepAwake } from '@/hooks/useKeepAwake';
import { TouchWake } from '@/ui/components/TouchWake';

const SCREEN_OPTIONS = { headerShown: false, animation: 'none', gestureEnabled: false } as const;

/**
 * Live Stream's own stack: S1's Settings (its Diagnostics card with it) lives here, so it stays reachable on air
 * (AGENTS §6) while leaving the mode does not. The screen stays on for as long as the engine holds a session, and
 * while paired and waiting it dims after 30 s with no touch anywhere in the route (D2 §4.5).
 */
export default function StreamLayout() {
  useKeepAwake();
  return (
    <TouchWake>
      <Stack screenOptions={SCREEN_OPTIONS} />
    </TouchWake>
  );
}
