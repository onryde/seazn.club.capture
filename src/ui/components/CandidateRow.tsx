import { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { blockedLine, placeOf } from '@/domain/matchday/callCopy';
import type { Candidate } from '@/domain/matchday/callWire';
import { useFormatTime } from '@/hooks/useFormatTime';
import { useT } from '@/hooks/useLanguage';
import { useRowWords } from '@/hooks/useRowWords';
import type { MessageKey } from '@/i18n/messages';
import { MatchRow } from '@/ui/components/MatchRow';
import { Text } from '@/ui/components/Text';
import { colour, layout, space } from '@/ui/theme/tokens';

type CandidateRowProps = {
  readonly candidate: Candidate;
  /** The court the sheet is about, for "Next on {court}" of this court's own match. */
  readonly court: string;
  /** The venue's zone, for the planned time. */
  readonly zone: string;
  /** The day lists more than one division (`showsDivision`). */
  readonly withDivision: boolean;
  readonly onPick: (candidate: Candidate) => void;
  /** A hairline above it, between two matches (owner, 2026-11-13: "light divider between matches"); not the first. */
  readonly divided?: boolean;
};

/**
 * One match the desk offers a free court (S4 design §7a): its round chip, its names (the day's words, slots for an
 * empty seat) and its planned time, with where it is now under them ("Next on Court 2", "Called to Court 2", "Not on a court yet"). A
 * candidate whose player is in a match elsewhere is dimmed, says so, and is not a control at all: no press, no role.
 */
const PLACE_KEY = {
  nextOn: 'matchday.call.nextOn',
  queuedOn: 'matchday.call.queuedOn',
  calledTo: 'matchday.call.calledTo',
} as const;

export const CandidateRow = memo(function CandidateRow({
  candidate,
  court,
  zone,
  withDivision,
  onPick,
  divided = false,
}: CandidateRowProps) {
  const { t } = useT();
  const words = useRowWords(zone, withDivision)(candidate.match);
  const time = useFormatTime();
  const place = placeOf(candidate, court);
  const where =
    place.kind === 'noCourt'
      ? t('matchday.noCourt')
      : t(PLACE_KEY[place.kind], { court: place.court });
  const reason = blockedLine(candidate);
  const press = useCallback(() => onPick(candidate), [onPick, candidate]);
  const detail = candidate.plannedAt === null ? null : time(candidate.plannedAt, zone);
  const blocked = reason !== null;
  return (
    <View testID="candidate" style={divided ? dividedCandidate : styles.candidate}>
      <MatchRow
        chip={words.chip}
        names={words.names}
        parts={words.parts}
        division={words.division}
        detail={detail}
        dim={blocked}
        {...(blocked ? {} : { onPress: press })}
      />
      <Text variant="control" style={blocked ? styles.whereDim : styles.where}>
        {where}
      </Text>
      {reason === null ? null : (
        <Text variant="control" testID="candidate-blocked" style={styles.blocked}>
          {t(reason.key as MessageKey, reason.vars)}
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  candidate: { paddingBottom: space.sm },
  divider: { paddingTop: space.sm, borderTopWidth: layout.cardBorder, borderTopColor: colour.rule },
  where: { color: colour.ink2 },
  whereDim: { color: colour.ink3 },
  blocked: { color: colour.ink3 },
});

const dividedCandidate = [styles.candidate, styles.divider];
