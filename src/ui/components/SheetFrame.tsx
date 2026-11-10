import { memo, type ReactNode } from 'react';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { padSheet } from '@/ui/components/padSheet';

/**
 * The shape the cricket sheets share (`padSheet.ts`): a dim over the pad and a panel on the bottom edge, modal to a screen
 * reader (native reads `accessibilityViewIsModal`, react-native-web `aria-modal`). The dim is a touch target only,
 * hidden from a screen reader: `onDim` is what a touch on it does, and none when the sheet stands by itself (the
 * over-end sheet), where a touch on the dim covering the board, the top bar and the keys must take nothing back. A dim
 * with no handler still swallows the touch, so nothing under it is reached.
 */
export const SheetFrame = memo(function SheetFrame({
  testID,
  dimTestID,
  onDim,
  style,
  children,
}: {
  readonly testID: string;
  readonly dimTestID: string;
  readonly onDim: (() => void) | null;
  readonly style?: StyleProp<ViewStyle>;
  readonly children: ReactNode;
}) {
  return (
    <View style={padSheet.overlay}>
      <Pressable testID={dimTestID} aria-hidden onPress={onDim ?? undefined} style={padSheet.dim} />
      <View testID={testID} accessibilityViewIsModal aria-modal style={[padSheet.sheet, style]}>
        {children}
      </View>
    </View>
  );
});
