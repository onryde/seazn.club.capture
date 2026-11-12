import { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { canReview, type Banner } from '@/domain/matchday/matchDay';
import { useT } from '@/hooks/useLanguage';
import type { Translator } from '@/i18n/translate';
import { GhostButton } from '@/ui/components/GhostButton';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

/**
 * The first approval waiting, over the list (S4 design §5, §7): a Swiss round's pairings or a knockout draw, said as the
 * organiser's desk says it. Without the right to approve on this code, the line says where it is done instead. Task 6
 * gives the banner its Review button, only where the phone may approve and name a round; otherwise it is a line, never
 * a control.
 */
export const ApprovalBanner = memo(function ApprovalBanner({
  banner,
  onReview,
}: {
  readonly banner: Banner;
  /** Opens the review of the stage this banner names. */
  readonly onReview: (approval: Banner['approval']) => void;
}) {
  const { t } = useT();
  const { approval } = banner;
  const review = useCallback(() => onReview(approval), [onReview, approval]);
  return (
    <View testID="approval-banner" style={styles.banner}>
      <Text variant="controlInk">{bannerLine(banner, t)}</Text>
      {canReview(banner) ? (
        <GhostButton label={t('matchday.approve.review')} onPress={review} />
      ) : null}
    </View>
  );
});

/**
 * A Swiss stage with no round to name has no round line: it gets the generic web-desk line with its own label. So does
 * a round of 1, which has no round before it to call complete (review M5: never "Round 0 complete").
 */
function bannerLine({ approval, canApprove }: Banner, t: Translator['t']): string {
  if (approval.kind === 'draw') {
    const division = approval.divisionName;
    return t(canApprove ? 'matchday.approve.draw' : 'matchday.approve.webOnly.draw', { division });
  }
  if (approval.round === null || approval.round <= 1)
    return t('matchday.approve.webOnly', { label: approval.label });
  const done = String(approval.round - 1);
  if (!canApprove) return t('matchday.approve.webOnly.swiss', { done });
  return t('matchday.approve.swiss', { done, round: String(approval.round) });
}

const styles = StyleSheet.create({
  banner: {
    padding: layout.matchDayCardPad,
    gap: space.sm,
    borderRadius: radius.card,
    borderLeftWidth: layout.labelBar,
    borderColor: colour.lime,
    backgroundColor: colour.surface2,
  },
});
