import { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import type {
  ScorecardBatter,
  ScorecardBowler,
  ScorecardInnings,
} from '@/domain/scoring/cricketScorecard';
import { useT } from '@/hooks/useLanguage';
import { usePadText } from '@/hooks/usePadText';
import { NameText } from '@/ui/components/NameText';
import { Text } from '@/ui/components/Text';
import { colour, layout, space } from '@/ui/theme/tokens';

/**
 * The scorecard under Match details (S2-4 spec §6; plan Task 18): each innings played, in the order played, with its
 * total, batting (how out, runs and balls), who has not batted, the extras, the bowling and the fall of wickets. The
 * screen draws it only when an innings has been played. A section an innings has nothing for is not drawn (an innings
 * scored in over totals has only its total). The figures are the domain's (`scorecardView`); this only sets them out.
 * Names wrap at their gaps and are never cut; the sheet scrolls.
 */
export const CricketScorecard = memo(function CricketScorecard({
  innings,
}: {
  readonly innings: readonly ScorecardInnings[];
}) {
  return (
    <View testID="cricket-scorecard" style={styles.card}>
      {innings.map((one, at) => (
        <InningsBlock key={at} innings={one} ruled={at > 0} />
      ))}
    </View>
  );
});

const InningsBlock = memo(function InningsBlock({
  innings,
  ruled,
}: {
  readonly innings: ScorecardInnings;
  readonly ruled: boolean;
}) {
  const words = usePadText();
  const { batting, bowling } = innings;
  return (
    <View testID="card-innings" style={ruled ? ruledBlock : styles.block}>
      <Text testID="card-title" variant="label" accessibilityRole="header">
        {words(innings.title)}
      </Text>
      <Text testID="card-total" variant="metricValue">
        {words(innings.total)}
      </Text>
      {batting.length === 0 ? null : <BattingTable rows={batting} />}
      <Line id="card-didnotbat" said={innings.didNotBat} />
      <Line id="card-extras" said={innings.extras} />
      {bowling.length === 0 ? null : <BowlingTable rows={bowling} />}
      {innings.fall.length === 0 ? null : <FallOfWickets fall={innings.fall} />}
    </View>
  );
});

/** One line of words, or nothing. */
function Line({ id, said }: { readonly id: string; readonly said: ScorecardInnings['extras'] }) {
  const words = usePadText();
  if (said === null) return null;
  return (
    <Text testID={id} variant="body" style={styles.ink}>
      {words(said)}
    </Text>
  );
}

function Heading({ text }: { readonly text: string }) {
  return (
    <Text variant="state" accessibilityRole="header" style={styles.quiet}>
      {text}
    </Text>
  );
}

const BattingTable = memo(function BattingTable({
  rows,
}: {
  readonly rows: readonly ScorecardBatter[];
}) {
  const { t } = useT();
  const words = usePadText();
  return (
    <View testID="card-batting" style={styles.table}>
      <Heading text={t('scoring.cricket.players.batting')} />
      {rows.map((row, at) => (
        <CardRow
          key={at}
          testID="card-batter"
          name={row.name}
          how={words(row.how)}
          figures={words(row.score)}
        />
      ))}
    </View>
  );
});

const BowlingTable = memo(function BowlingTable({
  rows,
}: {
  readonly rows: readonly ScorecardBowler[];
}) {
  const { t } = useT();
  return (
    <View testID="card-bowling" style={styles.table}>
      <Heading text={t('scoring.cricket.players.bowling')} />
      {rows.map((row, at) => (
        <CardRow key={at} testID="card-bowler" name={row.name} figures={row.figures} />
      ))}
    </View>
  );
});

/** One player's line: the name, with how out under it where there is one, and the figures at the right. */
const CardRow = memo(function CardRow({
  testID,
  name,
  how,
  figures,
}: {
  readonly testID: string;
  readonly name: string;
  readonly how?: string;
  readonly figures: string;
}) {
  return (
    <View testID={testID} style={styles.row}>
      <View style={styles.who}>
        <NameText variant="body" style={styles.ink}>
          {name}
        </NameText>
        {how === undefined ? null : <Text variant="status">{how}</Text>}
      </View>
      <Text variant="metricValue" style={styles.figures}>
        {figures}
      </Text>
    </View>
  );
});

/** The wickets, as one wrapping line: "1-6 (Smith, 0.3 ov), 2-7 (Jones, 1.1 ov)". */
const FallOfWickets = memo(function FallOfWickets({
  fall,
}: {
  readonly fall: ScorecardInnings['fall'];
}) {
  const { t } = useT();
  const words = usePadText();
  const said = useMemo(() => fall.map(words).join(', '), [fall, words]);
  return (
    <View style={styles.table}>
      <Heading text={t('scoring.cricket.card.fallTitle')} />
      <Text testID="card-fall" variant="body" style={styles.ink}>
        {said}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { gap: space.md },
  block: { gap: space.sm },
  ruled: {
    gap: space.sm,
    paddingTop: space.md,
    borderTopWidth: layout.cardBorder,
    borderTopColor: colour.rule,
  },
  quiet: { color: colour.ink2 },
  ink: { color: colour.ink },
  table: { gap: space.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  who: { flex: 1, minWidth: 0 },
  figures: { flexShrink: 0, textAlign: 'right' },
});

const ruledBlock = styles.ruled;
