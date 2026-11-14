import { memo, useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import type { CourtDay } from '@/domain/matchday/courtDay';
import type { Row } from '@/domain/matchday/matchDay';
import { useT } from '@/hooks/useLanguage';
import { useRowWords, type RowWords } from '@/hooks/useRowWords';
import type { MessageKey } from '@/i18n/messages';
import { CourtRow, FinishedRows, STATE_WORD, StateChip } from '@/ui/components/CourtCard';
import { SubScreenHeader } from '@/ui/components/SubScreenHeader';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

type CourtDayScreenProps = {
  readonly day: CourtDay;
  /** The venue's zone, for the planned times. */
  readonly zone: string;
  /** The day lists more than one division (`showsDivision`): every row names its own. */
  readonly withDivision: boolean;
  /** A tap on a match: it opens, as on the court's card (the list's own `open`). */
  readonly onOpen: (row: Row, courtName: string) => void;
  /** The matches whose link this phone holds: only these finished rows open. */
  readonly opened: ReadonlySet<string>;
  readonly onClose: () => void;
};

/** The words over a court's queue: Next, Then, and nothing for the rest (a planned time is on every row). */
const QUEUE_LABEL: readonly (MessageKey | null)[] = ['matchday.row.next', 'matchday.row.then'];

/**
 * One court's whole day (owner, 2026-11-13: "If I click Court 2, can we open screen with full list and finished
 * matches less?"), over Match Day's list in the call screen's overlay style: the court's name, its state, the match on
 * it, every match still to play in the server's order, and the finished ones under their heading, the latest alone
 * until "+N more finished" is tapped. Its rows are the card's rows and open as they do. Android Back closes it (the list's hook subscribes while it shows).
 */
export const CourtDayScreen = memo(function CourtDayScreen({
  day,
  zone,
  withDivision,
  onOpen,
  opened,
  onClose,
}: CourtDayScreenProps) {
  const { t } = useT();
  const words = useRowWords(zone, withDivision);
  const [expanded, setExpanded] = useState(false);
  const flip = useCallback(() => setExpanded((now) => !now), []);
  return (
    <View
      testID="court-day-screen"
      aria-modal
      accessibilityViewIsModal
      accessibilityLabel={day.name}
      style={styles.screen}
    >
      <View style={styles.bar}>
        <SubScreenHeader
          title={day.name}
          onBack={onClose}
          plate={false}
          backLabel={t('mode.matchday')}
        />
      </View>
      <ScrollView style={styles.body} contentContainerStyle={styles.column}>
        <Head day={day} />
        <View style={styles.card}>
          <Queue day={day} words={words} onOpen={onOpen} />
          <FinishedRows
            court={day.name}
            courtId={day.courtId}
            rows={day.finished}
            words={words}
            onOpen={onOpen}
            opened={opened}
            expanded={expanded}
            onToggle={flip}
          />
        </View>
      </ScrollView>
    </View>
  );
});

/** The venue the court is in, and its state as the card's chip says it. */
const Head = memo(function Head({ day }: { readonly day: CourtDay }) {
  const { t } = useT();
  return (
    <View style={styles.head}>
      {day.venueName === '' ? null : (
        <Text variant="control" numberOfLines={1} style={styles.venue}>
          {day.venueName}
        </Text>
      )}
      <StateChip state={day.state} word={t(STATE_WORD[day.state])} />
    </View>
  );
});

/** Now, then every match still to play, in order; a hairline above every one but the first. */
const Queue = memo(function Queue({
  day,
  words,
  onOpen,
}: {
  readonly day: CourtDay;
  readonly words: (row: Row) => RowWords;
  readonly onOpen: (row: Row, courtName: string) => void;
}) {
  const { t } = useT();
  const rows: readonly (readonly [Row, string | undefined])[] = [
    ...(day.now === null ? [] : [[day.now, t('matchday.row.now')] as const]),
    ...day.upcoming.map((row, at) => {
      const key = QUEUE_LABEL[at];
      return [row, key === undefined || key === null ? undefined : t(key)] as const;
    }),
  ];
  return rows.map(([row, label], at) => (
    <CourtRow
      key={row.fixtureId}
      row={row}
      court={day.name}
      words={words}
      onOpen={onOpen}
      divided={at > 0}
      {...(label === undefined ? {} : { label })}
    />
  ));
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
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  venue: { flex: 1, minWidth: 0, color: colour.ink2 },
  card: {
    paddingHorizontal: layout.matchDayCardPad,
    borderRadius: radius.card,
    borderWidth: layout.cardBorder,
    borderColor: colour.rule,
    backgroundColor: colour.surface,
  },
});
