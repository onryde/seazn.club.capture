import { memo, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { HOLD_MS } from '@/hooks/useHold';
import { colour } from '@/ui/theme/tokens';

/**
 * The hold's progress, on the UI thread (AGENTS §8). Lime for Go live, cream
 * for Stop (D15): a fill is never red, which means only ON AIR.
 *
 * `ReduceMotion.Never`: this motion is the progress itself. Under the system
 * setting Reanimated 4.5.1 jumps a timing straight to its end
 * (src/animation/util.ts, `animation.current = animation.toValue`), so a full
 * fill would say "done" three seconds before the hold acts.
 */
const FILL = { duration: HOLD_MS, easing: Easing.linear, reduceMotion: ReduceMotion.Never };

export const HoldFill = memo(function HoldFill({
  holding,
  tone,
}: {
  holding: boolean;
  tone: 'go' | 'stop';
}) {
  const progress = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(progress);
    progress.value = holding ? withTiming(1, FILL) : 0;
  }, [holding, progress]);
  const width = useAnimatedStyle(() => ({ width: `${progress.value * 100}%` }));
  return <Animated.View pointerEvents="none" style={[TONE[tone], width]} />;
});

const styles = StyleSheet.create({
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, opacity: 0.35 },
  go: { backgroundColor: colour.lime },
  stop: { backgroundColor: colour.ink },
});

const TONE = { go: [styles.fill, styles.go], stop: [styles.fill, styles.stop] } as const;
