import { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { Button } from '@/ui/components/Button';
import { GhostButton } from '@/ui/components/GhostButton';
import { padSheet } from '@/ui/components/padSheet';
import { Text } from '@/ui/components/Text';
import { space } from '@/ui/theme/tokens';

/**
 * Exit's question on a court code (court stream spec 2026-11-14 §6.4, O5): "Leave Court 2?" and, under it, what leaving
 * costs. On Exit's own shape (`ExitMatchDaySheet`): Stay is the lime plate and first, the dim means Stay, and Leave is
 * the outline, so a thumb on the plate never leaves. Live Stream is landscape, where the screen is wide and short, so
 * the two plates sit in a row under the words and not one above the other: the question stays low and the camera
 * stays in view above it. A plain View on the pad's sheet shape. The caller's `useBackCloses` makes Back mean Stay.
 */
export const LeaveCourtSheet = memo(function LeaveCourtSheet({
  court,
  onStay,
  onLeave,
}: {
  readonly court: string;
  readonly onStay: () => void;
  readonly onLeave: () => void;
}) {
  const { t } = useT();
  return (
    <View style={padSheet.overlay}>
      <Pressable
        testID="leave-court-dim"
        aria-hidden
        importantForAccessibility="no-hide-descendants"
        onPress={onStay}
        style={padSheet.dim}
      />
      <View testID="leave-court-sheet" accessibilityViewIsModal aria-modal style={padSheet.sheet}>
        <Text variant="title">{t('stream.court.leaveTitle', { court })}</Text>
        <Text variant="body">{t('stream.court.leaveBody')}</Text>
        <View style={styles.plates}>
          <Button label={t('stream.court.stay')} onPress={onStay} />
          <GhostButton label={t('stream.court.leave')} onPress={onLeave} />
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  plates: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
