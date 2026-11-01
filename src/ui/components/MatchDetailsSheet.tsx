import { memo, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { GhostButton } from '@/ui/components/GhostButton';
import { padSheet } from '@/ui/components/padSheet';
import { Text } from '@/ui/components/Text';
import { space } from '@/ui/theme/tokens';

type MatchDetailsSheetProps = {
  readonly title: string;
  /** What the sheet says: a sport's Match details (`MatchDetails`, then `RuleLines`), already in its words. */
  readonly children: ReactNode;
  readonly closeLabel: string;
  readonly onClose: () => void;
};

/**
 * Match details in a bottom sheet over the pad, for any sport (owner ruling 15, 2026-10-31: "a sheet over the pad with
 * the match rules and Close"; owner, 2026-11-01: where the match sits, then its rules). The title stays at the top and
 * Close at the bottom; what is between scrolls when it is taller than the screen. A plain View, as every pad sheet
 * (`padSheet.ts`). Close, the dim and Back (the caller's `useBackCloses`) close it. Modal to a screen reader: native
 * reads `accessibilityViewIsModal`, react-native-web `aria-modal`. The dim is a touch target only; Close is its name.
 */
export const MatchDetailsSheet = memo(function MatchDetailsSheet({
  title,
  children,
  closeLabel,
  onClose,
}: MatchDetailsSheetProps) {
  return (
    <View style={padSheet.overlay}>
      <Pressable aria-hidden onPress={onClose} style={padSheet.dim} />
      <View testID="details-sheet" accessibilityViewIsModal aria-modal style={styles.sheet}>
        <Text variant="title">{title}</Text>
        <ScrollView testID="details-scroll" contentContainerStyle={styles.content}>
          {children}
        </ScrollView>
        <GhostButton label={closeLabel} onPress={onClose} />
      </View>
    </View>
  );
});

// It gives way when the words are taller than the screen, so the scroll takes the rest and Close stays on screen.
const styles = StyleSheet.create({
  sheet: { ...padSheet.sheet, flexShrink: 1 },
  content: { gap: space.md },
});
