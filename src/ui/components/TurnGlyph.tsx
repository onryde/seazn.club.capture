import { memo, useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import type { TurnCardKind } from '@/ui/components/TurnCard';
import { colour } from '@/ui/theme/tokens';

/**
 * A phone outline that turns the way the operator should, on the UI thread
 * (AGENTS §8). Still under reduced motion; the words carry the instruction.
 */
export const TurnGlyph = memo(function TurnGlyph({ card }: { card: TurnCardKind }) {
  const reduce = useReducedMotion();
  const turn = useSharedValue(0);
  const degrees = card === 'turnSideways' ? -90 : 90;

  useEffect(() => {
    if (reduce) return undefined;
    turn.value = withRepeat(
      withSequence(
        withDelay(400, withTiming(1, { duration: 900, reduceMotion: ReduceMotion.System })),
        withDelay(700, withTiming(0, { duration: 0 })),
      ),
      -1,
    );
    return () => cancelAnimation(turn);
  }, [reduce, turn]);

  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${degrees * turn.value}deg` }] }));
  return <Animated.View style={[styles.phone, style]} />;
});

const styles = StyleSheet.create({
  phone: { width: 44, height: 78, borderWidth: 3, borderColor: colour.lime, borderRadius: 9 },
});
