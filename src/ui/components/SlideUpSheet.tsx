import { memo } from 'react';
import type { ViewProps } from 'react-native';
import Animated, { ReduceMotion, SlideInDown } from 'react-native-reanimated';

const ENTER = SlideInDown.reduceMotion(ReduceMotion.System);

/**
 * A view that slides up from the bottom edge as it mounts (spec §Look), on the
 * UI thread (AGENTS §8). Under reduced motion it simply appears. Drawing only:
 * UI tests replace it with a plain View.
 */
export const SlideUpSheet = memo(function SlideUpSheet(props: ViewProps) {
  return <Animated.View entering={ENTER} {...props} />;
});
