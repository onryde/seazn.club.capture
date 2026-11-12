import { memo } from 'react';
import { Pressable, View } from 'react-native';
import { exitCopy } from '@/domain/matchday/exit';
import type { Stake } from '@/domain/matchday/matchDay';
import { useT } from '@/hooks/useLanguage';
import { Button } from '@/ui/components/Button';
import { GhostButton } from '@/ui/components/GhostButton';
import { padSheet } from '@/ui/components/padSheet';
import { Text } from '@/ui/components/Text';

/**
 * Exit's question (S4 design §4; MD-2 Task 7): "Exit Match Day?" and, under it, what leaving costs: nothing but a scan,
 * how many taps keep sending, or taps that cannot be read. Stay is the lime plate and first, as Keep is on the Dismiss
 * question, and the dim means Stay; Exit is the outline, so a thumb on the plate never leaves. A plain View on the pad's
 * sheet shape, as the other questions are. The caller's `useBackCloses` makes Back mean Stay.
 */
export const ExitMatchDaySheet = memo(function ExitMatchDaySheet({
  stake,
  onStay,
  onExit,
}: {
  readonly stake: Stake;
  readonly onStay: () => void;
  readonly onExit: () => void;
}) {
  const { t, tp } = useT();
  const copy = exitCopy(stake.count, stake.unreadable);
  const body = copy.body === 'matchday.exit.bodySending' ? tp(copy.body, copy.count) : t(copy.body);
  return (
    <View style={padSheet.overlay}>
      <Pressable
        testID="exit-dim"
        aria-hidden
        importantForAccessibility="no-hide-descendants"
        onPress={onStay}
        style={padSheet.dim}
      />
      <View testID="exit-confirm" accessibilityViewIsModal aria-modal style={padSheet.sheet}>
        <Text variant="title">{t('matchday.exit.title')}</Text>
        <Text variant="body">{body}</Text>
        <Button label={t('matchday.exit.stay')} onPress={onStay} />
        <GhostButton label={t('matchday.exit.confirm')} onPress={onExit} />
      </View>
    </View>
  );
});
