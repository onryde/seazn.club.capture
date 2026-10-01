import { memo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { colour, space } from '@/ui/theme/tokens';

/**
 * A solid strip on the top or bottom edge of the stage: the only thing ever
 * drawn over the preview (AGENTS §6, D17). Solid, so it never tints the shot.
 */
export const EdgeStrip = memo(function EdgeStrip({
  edge,
  children,
}: {
  edge: 'top' | 'bottom';
  children: ReactNode;
}) {
  return <View style={edge === 'top' ? top : bottom}>{children}</View>;
});

const styles = StyleSheet.create({
  strip: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    backgroundColor: colour.surface,
  },
  top: { top: 0 },
  bottom: { bottom: 0 },
});

const top = [styles.strip, styles.top];
const bottom = [styles.strip, styles.bottom];
