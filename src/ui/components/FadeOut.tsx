import type { ReactNode } from 'react';
import { StyleSheet, type ViewProps } from 'react-native';
import Animated, { FadeOut as FadeOutAnimation } from 'react-native-reanimated';

type Props = Pick<
  ViewProps,
  | 'accessible'
  | 'accessibilityLabel'
  | 'accessibilityViewIsModal'
  | 'aria-modal'
  | 'accessibilityLiveRegion'
> & { children: ReactNode };

/** Children fade on unmount, on the UI thread (AGENTS §8). Reduced motion is honoured by Reanimated. */
export function FadeOut({ children, ...accessibility }: Props) {
  return (
    <Animated.View
      exiting={FadeOutAnimation.duration(200)}
      style={StyleSheet.absoluteFill}
      {...accessibility}
    >
      {children}
    </Animated.View>
  );
}
