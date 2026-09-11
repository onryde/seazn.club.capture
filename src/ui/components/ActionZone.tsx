import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, type LayoutChangeEvent, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/ui/components/Text';
import { colour, space, status } from '@/ui/theme/tokens';

const HOLD_MS = 1200;

/**
 * The primary action, anchored to the screen edge rather than drawn as a button
 * (AGENTS.md §6). An enormous target against the bezel works with cold or wet
 * hands and cannot be mis-hit.
 *
 * `mode` encodes the asymmetry that matters: **Go Live is a tap, Stop is
 * hold-to-confirm.** An accidental start costs a Machine; an accidental stop
 * costs the match. Guard the expensive mistake, not both.
 *
 * The hold progress translates a full-width fill from off-screen left to zero,
 * measured by `onLayout`. It animates `translateX` rather than `width` so it
 * runs on the native driver — the UI thread, never JS — and deliberately does
 * not use `transformOrigin`, which react-native-web accepts as CSS but Android
 * rejects alongside a native-driven transform.
 */
export function ActionZone({
  label,
  mode,
  accent,
  disabled = false,
  reason,
  onAction,
}: {
  label: string;
  mode: 'tap' | 'hold';
  accent: string;
  disabled?: boolean;
  /** Why the action is unavailable, shown AT the control rather than four lines away. */
  reason?: string;
  onAction: () => void;
}) {
  const slide = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [width, setWidth] = useState(0);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    slide.stopAnimation(() => slide.setValue(0));
  }, [slide]);

  const beginHold = useCallback(() => {
    if (disabled) return;
    Animated.timing(slide, {
      toValue: 1,
      duration: HOLD_MS,
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
    timer.current = setTimeout(() => {
      timer.current = null;
      slide.setValue(0);
      onAction();
    }, HOLD_MS);
  }, [disabled, onAction, slide]);

  // A hold in progress when this unmounts would otherwise fire its action
  // afterwards — stopping a broadcast nobody asked to stop.
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const pressHandlers =
    mode === 'hold'
      ? { onPressIn: beginHold, onPressOut: cancel }
      : { onPress: disabled ? undefined : onAction };

  const translateX = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [-width, 0],
  });

  return (
    <Pressable
      {...pressHandlers}
      onLayout={onLayout}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={mode === 'hold' ? `${label}. Press and hold.` : label}
      accessibilityState={{ disabled }}
      style={styles.zone}
    >
      {mode === 'hold' && width > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.progress, { backgroundColor: accent, transform: [{ translateX }] }]}
        />
      ) : null}
      <View style={styles.labelRow}>
        <Text variant="action" style={disabled ? styles.labelDisabled : { color: accent }}>
          {label}
        </Text>
        {/* Caution, not inert grey: the reason is a fault to fix, and it will
            visually connect to the orange meter that is usually its cause. */}
        {reason === undefined ? null : (
          <Text variant="control" style={styles.reason}>
            {reason}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // No `flex: 1`. It used to swallow every spare pixel in the column and dump
  // it into one dead gap above the label; the column's own layout anchors this
  // zone to the bottom instead.
  zone: {
    justifyContent: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: colour.rule,
    paddingHorizontal: space.md,
    paddingBottom: space.md,
    paddingTop: space.md,
    overflow: 'hidden',
  },
  // Was 16% opacity, which over this ground is a luminance change of about
  // 0.01 — invisible outdoors, under a thumb, which is where it happens. A
  // solid fill is the only version the operator can actually see progressing.
  progress: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    opacity: 0.9,
  },
  labelRow: {
    minHeight: 48,
    justifyContent: 'flex-end',
    gap: space.xs,
  },
  labelDisabled: {
    color: colour.ink3,
  },
  reason: {
    color: status.degraded,
  },
});
