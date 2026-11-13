import { memo } from 'react';
import { StyleSheet } from 'react-native';
import type { Stake } from '@/domain/matchday/matchDay';
import { useT } from '@/hooks/useLanguage';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

/**
 * What a court's matches (or the matches on no court) still hold unsent (S4 design §5): "Sending N" while taps wait,
 * nothing when none do. A queue the phone cannot read puts them at risk, said in caution in place of a number (review
 * I1, `atStake`'s null): never silently nothing.
 */
export const StakeLine = memo(function StakeLine({ stake }: { readonly stake: Stake }) {
  const { t, tp } = useT();
  if (stake.unreadable)
    return (
      <Text variant="controlSmall" style={styles.atRisk}>
        {t('matchday.sending.atRisk')}
      </Text>
    );
  if (stake.count === 0) return null;
  return (
    <Text variant="controlSmall" style={styles.sending}>
      {tp('matchday.sending', stake.count)}
    </Text>
  );
});

const styles = StyleSheet.create({
  sending: { paddingBottom: space.xs, color: colour.ink2 },
  atRisk: { paddingBottom: space.xs, color: colour.caution },
});
