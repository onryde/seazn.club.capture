import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeOut as FadeOutAnimation } from 'react-native-reanimated';

/** Children fade on unmount, on the UI thread (AGENTS §8). Reduced motion is honoured by Reanimated. */
export function FadeOut({ children }: { children: ReactNode }) {
  return (
    <Animated.View exiting={FadeOutAnimation.duration(200)} style={StyleSheet.absoluteFill}>
      {children}
    </Animated.View>
  );
}
