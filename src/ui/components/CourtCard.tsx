import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type {
  CourtCard as CourtCardModel,
  CourtState,
  Row,
  Stake,
} from '@/domain/matchday/matchDay';
import { useT } from '@/hooks/useLanguage';
import { useRowWords, type RowWords } from '@/hooks/useRowWords';
import type { MessageKey } from '@/i18n/messages';
import { MatchRow } from '@/ui/components/MatchRow';
import { StakeLine } from '@/ui/components/StakeLine';
import { Text } from '@/ui/components/Text';
import { colour, layout, plateInk, radius, space } from '@/ui/theme/tokens';

/** The copy's word for each court state (the dispatch's ruling 3): the chip draws it and a screen reader says it. */
const STATE_WORD: Readonly<Record<CourtState, MessageKey>> = {
  playing: 'matchday.court.playing',
  called: 'matchday.court.called',
  free: 'matchday.court.free',
  inUseElsewhere: 'matchday.court.inUseElsewhere',
};

type CourtCardProps = {
  readonly card: CourtCardModel;
  /** The unsent taps of the matches on this court opened from Match Day (`StakeLine`). */
  readonly stake: Stake;
  /** The venue's zone, for the planned times. */
  readonly zone: string;
};

/**
 * One court on Match Day's list (S4 design §5, layout B): its name and its state in words, "Sending N" while taps of
 * its matches wait (or at risk, when a queue cannot be read), then Now, Next and Then, and its finished matches dimmed under their heading. Read-only here: Task 5
 * gives the rows their press.
 */
export const CourtCard = memo(function CourtCard({ card, stake, zone }: CourtCardProps) {
  const { t } = useT();
  const words = useRowWords(zone);
  const state = t(STATE_WORD[card.state]);
  return (
    <View testID="court-card" style={styles.card}>
      <View accessible accessibilityLabel={`${card.name}, ${state}`} style={styles.head}>
        <Text testID="court-name" variant="diagTitle" numberOfLines={1} style={styles.name}>
          {card.name}
        </Text>
        <StateChip state={card.state} word={state} />
      </View>
      <StakeLine stake={stake} />
      <QueueRows card={card} words={words} />
      <FinishedRows rows={card.finished} words={words} />
    </View>
  );
});

const QueueRows = memo(function QueueRows({
  card,
  words,
}: {
  readonly card: CourtCardModel;
  readonly words: (row: Row) => RowWords;
}) {
  const { t } = useT();
  const queue = [
    [card.now, t('matchday.row.now')],
    [card.next, t('matchday.row.next')],
    [card.then, t('matchday.row.then')],
  ] as const;
  return queue.map(([row, label]) =>
    row === null ? null : <MatchRow key={row.fixtureId} label={label} {...words(row)} />,
  );
});

const FinishedRows = memo(function FinishedRows({
  rows,
  words,
}: {
  readonly rows: readonly Row[];
  readonly words: (row: Row) => RowWords;
}) {
  const { t } = useT();
  if (rows.length === 0) return null;
  const heading = t('matchday.row.finished');
  return (
    <>
      <Text variant="diagSection" style={styles.finished}>
        {heading}
      </Text>
      {rows.map((row) => (
        <MatchRow key={row.fixtureId} spoken={heading} dim {...words(row)} />
      ))}
    </>
  );
});

/**
 * The state as a chip: Playing a lime plate in night ink, Called a lime outline, Free a lilac hairline, In use (by a
 * match outside this code) a quiet plate in the inert ink. Never red: red means ON AIR (AGENTS §5). Every word's colour
 * is set, since Fabric's default is black.
 */
const StateChip = memo(function StateChip({
  state,
  word,
}: {
  readonly state: CourtState;
  readonly word: string;
}) {
  return (
    <View style={[styles.chip, CHIP[state].box]}>
      <Text variant="state" numberOfLines={1} style={CHIP[state].word}>
        {word}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: layout.matchDayCardPad,
    paddingVertical: space.sm,
    borderRadius: radius.card,
    borderWidth: layout.cardBorder,
    borderColor: colour.rule,
    backgroundColor: colour.surface,
  },
  head: { minHeight: layout.touch, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  name: { flex: 1, minWidth: 0 },
  finished: { paddingTop: space.sm, color: colour.ink3 },
  chip: {
    flexShrink: 0,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderWidth: layout.cardBorder,
  },
});

const chips = StyleSheet.create({
  playingBox: { backgroundColor: colour.lime, borderColor: colour.lime },
  playingWord: { color: plateInk },
  calledBox: { borderColor: colour.lime },
  calledWord: { color: colour.lime },
  freeBox: { borderColor: colour.ink3 },
  freeWord: { color: colour.ink2 },
  inUseBox: { backgroundColor: colour.surface2, borderColor: colour.surface2 },
  inUseWord: { color: colour.ink3 },
});

const CHIP = {
  playing: { box: chips.playingBox, word: chips.playingWord },
  called: { box: chips.calledBox, word: chips.calledWord },
  free: { box: chips.freeBox, word: chips.freeWord },
  inUseElsewhere: { box: chips.inUseBox, word: chips.inUseWord },
} as const satisfies Record<CourtState, object>;
