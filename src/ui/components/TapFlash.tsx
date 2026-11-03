import { memo, useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { flashMove } from '@/domain/scoring/tapFlash';
import { colour } from '@/ui/theme/tokens';

/** How far the lime rises (a low opacity: the score stays readable through it), and how fast; 300 ms in all. */
const PEAK = 0.3;
const RISE = { duration: 80 };
const FADE = { duration: 220 };

/**
 * A half's flash (owner ruling 14, 2026-10-31: "the tapped half flashes lime briefly so you see at a glance your tap
 * counted"): a lime wash over the half that rises and fades, on the UI thread (AGENTS §8), when its `cue` moves to a
 * new counted tap (`flashMove`). It never flashes as it mounts, and a cue gone to 0 stops it. No `entering` animation:
 * it is always mounted, and only its opacity moves. Under the system's reduced motion the sequence jumps to its last
 * value, 0, so nothing shows (Reanimated 4.5.1, src/animation/sequence.ts: a reduced sequence starts at its last step).
 * It takes no touch and is hidden from a screen reader: the half is the button. Drawing only: UI tests stub it.
 */
export const TapFlash = memo(function TapFlash({ cue }: { readonly cue: number }) {
  const opacity = useSharedValue(0);
  const seen = useRef(cue);
  useEffect(() => {
    const move = flashMove(seen.current, cue);
    seen.current = cue;
    if (move === 'none') return;
    cancelAnimation(opacity);
    opacity.value =
      move === 'flash'
        ? withSequence(ReduceMotion.System, withTiming(PEAK, RISE), withTiming(0, FADE))
        : 0;
  }, [cue, opacity]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      testID="tap-flash"
      pointerEvents="none"
      aria-hidden
      style={[styles.wash, fade]}
    />
  );
});

const styles = StyleSheet.create({
  wash: { ...StyleSheet.absoluteFill, backgroundColor: colour.lime },
});
