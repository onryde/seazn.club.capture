import { memo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { GhostButton } from '@/ui/components/GhostButton';
import { padSheet } from '@/ui/components/padSheet';
import { colour, space } from '@/ui/theme/tokens';

type MatchDetailsSheetProps = {
  /** What the sheet says: a sport's match card (`MatchCard`), already in its words. */
  readonly children: ReactNode;
  readonly closeLabel: string;
  readonly onClose: () => void;
};

/**
 * Match details in a bottom sheet over the pad, for any sport (owner ruling 15, 2026-10-31: "a sheet over the pad with
 * the match rules and Close"; owner, 2026-11-01, option A: the match card, then Close, no title: the card's header says
 * what it is). Close stays at the bottom; the card scrolls when it is taller than the screen. A plain View, as every pad sheet
 * (`padSheet.ts`). Close, the dim and Back (the caller's `useBackCloses`) close it. Modal to a screen reader: native
 * reads `accessibilityViewIsModal`, react-native-web `aria-modal`. The dim is a touch target only; Close is its name.
 */
export const MatchDetailsSheet = memo(function MatchDetailsSheet({
  children,
  closeLabel,
  onClose,
}: MatchDetailsSheetProps) {
  return (
    <View style={padSheet.overlay}>
      <Pressable aria-hidden onPress={onClose} style={padSheet.dim} />
      <View testID="details-sheet" accessibilityViewIsModal aria-modal style={styles.sheet}>
        <ScrollView testID="details-scroll" contentContainerStyle={styles.content}>
          {children}
        </ScrollView>
        <GhostButton label={closeLabel} onPress={onClose} />
      </View>
    </View>
  );
});

// It gives way when the words are taller than the screen, so the scroll takes the rest and Close stays on screen. On
// surface, not the other sheets' surface2: the match card's versus panel is surface2, and it stands on surface on the
// Not started card too.
const styles = StyleSheet.create({
  sheet: { ...padSheet.sheet, flexShrink: 1, backgroundColor: colour.surface },
  content: { gap: space.md },
});
