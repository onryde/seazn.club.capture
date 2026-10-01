import { useCallback, useEffect } from 'react';
import { usePorts } from '@/hooks/usePorts';
import { isStreamSubRoute } from '@/services/devicePorts';

/** The viewfinder's ways into Settings and Diagnostics, open in every state (AGENTS §6). */
export function useStreamLinks(): { settings(): void; diagnostics(): void } {
  const { navigation } = usePorts();
  const settings = useCallback(() => navigation.go('streamSettings'), [navigation]);
  const diagnostics = useCallback(() => navigation.go('streamDiagnostics'), [navigation]);
  return { settings, diagnostics };
}

/**
 * Back from Settings or Diagnostics returns to the camera, and never runs the
 * viewfinder's leave rule. Handled only while a sub-screen is the route (M21):
 * once back on the camera, even before this screen has gone, Back is the
 * viewfinder's, which on air says how to stop.
 */
export function useBackToViewfinder(): () => void {
  const { navigation, back } = usePorts();
  const toCamera = useCallback(() => navigation.go('stream'), [navigation]);
  useEffect(
    () =>
      back.subscribe(() => {
        if (!isStreamSubRoute(navigation.current())) return false;
        toCamera();
        return true;
      }),
    [back, navigation, toCamera],
  );
  return toCamera;
}
