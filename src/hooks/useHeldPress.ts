import { useCallback, useEffect, useRef } from 'react';
import { useStableCallback } from '@/hooks/useStableCallback';

export type HeldPress = { pressIn(): void; pressOut(): void };

/**
 * A held control's press handlers, which also let go if the control unmounts
 * while held. React Native sends no onPressOut then: the Pressable's
 * Pressability is reset on unmount (RN 0.86 usePressability.js, `reset()`),
 * and react-native-web does not send one either. Review M4.
 */
export function useHeldPress(onPressIn: () => void, onPressOut: () => void): HeldPress {
  const held = useRef(false);
  const release = useStableCallback(onPressOut);
  const pressIn = useCallback(() => {
    held.current = true;
    onPressIn();
  }, [onPressIn]);
  const pressOut = useCallback(() => {
    held.current = false;
    onPressOut();
  }, [onPressOut]);
  useEffect(
    () => () => {
      if (held.current) release();
    },
    [release],
  );
  return { pressIn, pressOut };
}
