import { memo } from 'react';
import { Pressable, View } from 'react-native';
import { Button } from '@/ui/components/Button';
import { GhostButton } from '@/ui/components/GhostButton';
import { padSheet } from '@/ui/components/padSheet';
import { Text } from '@/ui/components/Text';

type DismissSheetProps = {
  readonly title: string;
  readonly body: string;
  readonly keepLabel: string;
  readonly dismissLabel: string;
  readonly onKeep: () => void;
  readonly onDismiss: () => void;
};

/**
 * The question before a Dismiss that throws unsent taps away (owner ruling B, 2026-11-02), on a scoring screen: the
 * match and the count in the title and sentence, then Keep, the lime plate and first, and Dismiss as the outline. The
 * dim means Keep, as Back does (the caller's `useBackCloses`). A plain View on the pad's sheet shape (`padSheet`), as the
 * pad's own sheets, so the scoring screens ask in one voice; Home asks the same question in its code panel's sheet.
 */
export const DismissSheet = memo(function DismissSheet({
  title,
  body,
  keepLabel,
  dismissLabel,
  onKeep,
  onDismiss,
}: DismissSheetProps) {
  return (
    <View style={padSheet.overlay}>
      <Pressable
        testID="dismiss-dim"
        aria-hidden
        importantForAccessibility="no-hide-descendants"
        onPress={onKeep}
        style={padSheet.dim}
      />
      <View testID="dismiss-confirm" accessibilityViewIsModal aria-modal style={padSheet.sheet}>
        <Text variant="title">{title}</Text>
        <Text variant="body">{body}</Text>
        <Button label={keepLabel} onPress={onKeep} />
        <GhostButton label={dismissLabel} onPress={onDismiss} />
      </View>
    </View>
  );
});
