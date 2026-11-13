import { memo, useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { ApprovalReview } from '@/domain/matchday/approvalWire';
import type { Approval } from '@/domain/matchday/matchDay';
import { useApproval, type ApprovalRefusal, type ApprovalView } from '@/hooks/useApproval';
import { useBackCloses } from '@/hooks/useBackCloses';
import { useT } from '@/hooks/useLanguage';
import type { MessageKey } from '@/i18n/messages';
import { GhostButton } from '@/ui/components/GhostButton';
import { HoldAction } from '@/ui/components/HoldAction';
import { MatchRow } from '@/ui/components/MatchRow';
import { SubScreenHeader } from '@/ui/components/SubScreenHeader';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

type ApprovalScreenProps = {
  /** The approval the banner named: its kind, stage and, for the line with no hold, its own label. */
  readonly approval: Approval;
  /** Reads the day again (the list's own read), after an approve or a refusal that changes it. */
  readonly refresh: () => void;
  /** Closes the review, back to the list. */
  readonly onClose: () => void;
  /** The list's record of the approves this phone has sent (`ApprovalSink.sent`). */
  readonly sent: Set<string>;
};

const REFUSAL_LINE: Readonly<Record<ApprovalRefusal, MessageKey>> = {
  stale: 'matchday.approve.stale',
  already: 'matchday.approve.already',
  own: 'matchday.approve.approved',
  ties: 'matchday.approve.ties',
  onWeb: 'matchday.approve.onWeb',
  offline: 'matchday.offlineEmpty',
};

/**
 * Review and approve a Swiss round's pairings or a knockout draw (S4 design §7; MD-2 Task 6), over the list: the
 * proposal read-only as the server computed it ("To change a slot, use the web desk") and the shared 3 s hold to
 * approve it (AGENTS §6; `useHold`, `HoldFill`), the plate saying "Hold 3 s". Nothing is hold-able with ties, or a Swiss
 * proposal with no round: those say the web desk. Android Back closes it, as it closes any overlay.
 */
export const ApprovalScreen = memo(function ApprovalScreen({
  approval,
  refresh,
  onClose,
  sent,
}: ApprovalScreenProps) {
  const { t } = useT();
  const sink = useMemo(() => ({ refresh, close: onClose, sent }), [refresh, onClose, sent]);
  const view = useApproval(approval.kind, approval.stageId, sink);
  useBackCloses(true, onClose);
  return (
    <View
      testID="approval-screen"
      aria-modal
      accessibilityViewIsModal
      accessibilityLabel={t('matchday.approve.review')}
      style={styles.screen}
    >
      <View style={styles.bar}>
        <SubScreenHeader
          title={t('matchday.approve.review')}
          onBack={onClose}
          plate={false}
          backLabel={t('mode.matchday')}
        />
      </View>
      <ScrollView style={styles.body} contentContainerStyle={styles.column}>
        <Proposal approval={approval} view={view} />
      </ScrollView>
      <View style={styles.footer}>
        <Footer approval={approval} view={view} />
      </View>
    </View>
  );
});

const Proposal = memo(function Proposal({
  approval,
  view,
}: {
  readonly approval: Approval;
  readonly view: ApprovalView;
}) {
  const { t } = useT();
  const { review, state, refusal } = view;
  const divisionName = review?.divisionName ?? approval.divisionName;
  const round = review?.round ?? approval.round;
  const heading =
    approval.kind === 'draw'
      ? t('matchday.approve.heading.draw', { division: divisionName })
      : t('matchday.approve.heading.swiss', {
          division: divisionName,
          round: round === null ? approval.label : String(round),
        });
  return (
    <>
      <Text variant="controlInk" numberOfLines={2}>
        {heading}
      </Text>
      {refusal === null ? null : (
        <Text variant="control" testID="approval-line" style={styles.line}>
          {t(
            refusal === 'stale' && approval.kind === 'swiss'
              ? 'matchday.approve.staleSwiss'
              : REFUSAL_LINE[refusal],
          )}
        </Text>
      )}
      {state === 'loading' ? <Text variant="body">{t('matchday.approve.loading')}</Text> : null}
      {review === null ? null : <Rows review={review} />}
    </>
  );
});

const Rows = memo(function Rows({ review }: { readonly review: ApprovalReview }) {
  const { t } = useT();
  const open = t(review.kind === 'swiss' ? 'matchday.approve.bye' : 'matchday.seat.tbd');
  return (
    <View style={styles.rows}>
      {review.rows.map((row, at) => (
        <MatchRow
          key={`${row.label}-${at}`}
          label={row.label}
          names={t('matchday.row.match', { home: row.home, away: row.away ?? open })}
          detail={null}
        />
      ))}
      <Text variant="control" style={styles.change}>
        {t('matchday.approve.change')}
      </Text>
    </View>
  );
});

/** The hold, or what stands in its place: offline's Review again, or the web desk's words when the phone may not approve. */
const Footer = memo(function Footer({
  approval,
  view,
}: {
  readonly approval: Approval;
  readonly view: ApprovalView;
}) {
  const { t } = useT();
  const { review, state, approve, reviewAgain } = view;
  if (state === 'offline')
    return (
      <>
        <Text variant="control" style={styles.line}>
          {t('matchday.offlineEmpty')}
        </Text>
        <GhostButton label={t('matchday.approve.reviewAgain')} onPress={reviewAgain} />
      </>
    );
  if (state === 'ready' || state === 'approving') {
    if (review !== null && review.ties)
      return <Text variant="control">{t('matchday.approve.ties')}</Text>;
    if (review !== null && review.kind === 'swiss' && review.round === null)
      return (
        <Text variant="control">{t('matchday.approve.webOnly', { label: approval.label })}</Text>
      );
    const approving = state === 'approving';
    return (
      <HoldAction
        label={t('matchday.approve.hold')}
        a11yLabel={t('stream.action.holdLabel', { label: t('matchday.approve.action') })}
        tone="go"
        disabled={approving}
        reason={approving ? t('matchday.approve.approving') : null}
        onHeld={approve}
      />
    );
  }
  return null;
});

const styles = StyleSheet.create({
  screen: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colour.ground,
  },
  bar: { paddingHorizontal: space.md, paddingTop: space.md, paddingBottom: space.sm },
  body: { flex: 1 },
  column: { gap: space.md, paddingHorizontal: space.md, paddingBottom: space.md },
  line: { color: colour.caution },
  rows: {
    paddingHorizontal: layout.matchDayCardPad,
    borderRadius: radius.card,
    borderWidth: layout.cardBorder,
    borderColor: colour.rule,
    backgroundColor: colour.surface,
  },
  change: { color: colour.ink2, paddingVertical: space.sm },
  footer: { gap: space.sm, padding: space.md },
});
