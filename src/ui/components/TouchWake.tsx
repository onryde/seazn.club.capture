import { useCallback, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useIdleDim } from '@/hooks/useIdleDim';

/**
 * The Live Stream route's root (D2 §4.5): every touch in the route, Settings included, restarts the idle dim's 30 s
 * and wakes a dimmed screen. The capture phase sees the touch first and always answers false, so it never takes the
 * touch from the control under the finger.
 */
export function TouchWake({ children }: { children: ReactNode }) {
  const touched = useIdleDim();
  const capture = useCallback(() => {
    touched();
    return false;
  }, [touched]);
  return (
    <View style={styles.root} onStartShouldSetResponderCapture={capture}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });
