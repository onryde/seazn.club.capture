import type { ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colour, layout, space } from '@/ui/theme/tokens';

/**
 * The control column.
 *
 * Its width is what geometry leaves over: a correctly uncropped 16:9 preview
 * cannot fill a ~19.5:9 screen. Derived from the window rather than fixed,
 * because a constant 150 ate five pixels of picture on an 812×375 handset —
 * and nothing may be drawn over the shot (AGENTS.md §6). Where the leftover is
 * narrower than the column needs, the preview letterboxes instead; a smaller
 * picture is acceptable, a cropped one is a lie.
 *
 * It no longer carries the tally itself. Tinting the column at 10–12% over
 * `#150b36` produced four fields whose relative luminance differed by about
 * 0.01 — with live actually *darker* than ready — which outdoor reflection
 * swamps entirely. State moved to a solid plate in the state zone, where it can
 * be seen unfocused from two metres.
 */
export function TallyColumn({
  side = 'right',
  children,
}: {
  side?: 'left' | 'right';
  children: ReactNode;
}) {
  // The window includes the system bars; the root's safe area does not. Measure
  // what is actually left, or the column is computed for space it cannot use.
  const window = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const width = window.width - insets.left - insets.right;
  const height = window.height - insets.top - insets.bottom;
  const leftover = Math.round(width - height * layout.previewAspect);
  const columnWidth = Math.max(layout.columnWidth, leftover);

  const divider =
    side === 'right'
      ? { borderLeftWidth: StyleSheet.hairlineWidth }
      : { borderRightWidth: StyleSheet.hairlineWidth };

  return <View style={[styles.column, { width: columnWidth }, divider]}>{children}</View>;
}

const styles = StyleSheet.create({
  column: {
    borderColor: colour.rule,
    paddingTop: space.sm,
    justifyContent: 'flex-start',
  },
});
