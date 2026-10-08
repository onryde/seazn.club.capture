import { useCallback, useEffect } from 'react';
import { usePorts } from '@/hooks/usePorts';
import { isStreamSubRoute } from '@/services/devicePorts';

/** The viewfinder's way into Settings (Diagnostics is a card in it, spec §6), open in every state (AGENTS §6). */
export function useStreamLinks(): { settings(): void } {
  const { navigation } = usePorts();
  const settings = useCallback(() => navigation.go('streamSettings'), [navigation]);
  return { settings };
}

/**
 * Back from Settings returns to the camera, and never runs the
 * viewfinder's leave rule. Handled only while Settings is the route (M21):
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
