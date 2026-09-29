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
import type { TurnCardKind } from '@/domain/orientation/orientation';
import { turnDegrees } from '@/ui/turnPose';
import { colour } from '@/ui/theme/tokens';

const HELD = 0;
const TARGET = 1;

/**
 * A phone outline that turns from the pose the operator holds to the one asked
 * for, on the UI thread (AGENTS §8). Under reduced motion it stands still in
 * the target pose; the words carry the instruction.
 */
export const TurnGlyph = memo(function TurnGlyph({ card }: { card: TurnCardKind }) {
  const reduce = useReducedMotion();
  const turn = useSharedValue(reduce ? TARGET : HELD);

  useEffect(() => {
    if (reduce) {
      // Also settles a loop cancelled mid-turn, so it never rests at a tilt.
      turn.value = TARGET;
      return undefined;
    }
    turn.value = HELD;
    turn.value = turnLoop();
    return () => cancelAnimation(turn);
  }, [reduce, turn]);

  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turnDegrees(card, turn.value)}deg` }],
  }));
  return <Animated.View style={[styles.phone, style]} />;
});

/** Hold the held pose, turn to the target, hold, snap back; forever. */
function turnLoop(): number {
  return withRepeat(
    withSequence(
      withDelay(400, withTiming(TARGET, { duration: 900, reduceMotion: ReduceMotion.System })),
      withDelay(700, withTiming(HELD, { duration: 0 })),
    ),
    -1,
  );
}

const styles = StyleSheet.create({
  phone: { width: 44, height: 78, borderWidth: 3, borderColor: colour.lime, borderRadius: 9 },
});
