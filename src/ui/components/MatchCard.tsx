import { memo, useCallback, useMemo, useState } from 'react';
import {
  type LayoutChangeEvent,
  type StyleProp,
  StyleSheet,
  View,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { contextSaid, divisionAndRound, type MatchContext } from '@/domain/scoring/matchContext';
import { SIDES } from '@/domain/session/matchLabel';
import { useT } from '@/hooks/useLanguage';
import { NameText } from '@/ui/components/NameText';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

/** One row of a sport's rules table, already in the operator's words: "Format", "Best of 3 games". */
export type MatchCardRow = { readonly label: string; readonly value: string };

/**
 * Where a match sits and how it is played, for any sport (owner, 2026-11-01, option A, on build 715: "looks like paste
 * some text, we need a proper format also it can change per sport"). The Start screen, the Not started card and the
 * Match details sheet draw it. In order: the header (the competition, the division · round, the match on a plate), the
 * versus block (the sides as the match label draws them, C2), and the rules table of the sport's rows
 * (`badmintonRuleRows`). The organiser's words are never translated; nothing is cut, and the caller scrolls.
 */
export const MatchCard = memo(function MatchCard({
  context,
  rows,
}: {
  readonly context: MatchContext;
  readonly rows: readonly MatchCardRow[];
}) {
  return (
    <View testID="match-card" style={styles.card}>
      <Header context={context} />
      <Versus first={context.sides[0]} second={context.sides[1]} />
      {/* Keyed on the labels: another language or sport is a new table, so its label column is measured afresh. */}
      <RulesTable key={rows.map((row) => row.label).join('\n')} rows={rows} />
    </View>
  );
});

/** One stop for a screen reader, which hears it as one line (`contextSaid`). A piece left out is not drawn. */
const Header = memo(function Header({ context }: { readonly context: MatchContext }) {
  const where = divisionAndRound(context);
  const match = context.match === null || context.match.trim() === '' ? null : context.match;
  return (
    <View
      testID="match-card-header"
      accessible
      accessibilityLabel={contextSaid(context)}
      style={styles.header}
    >
      <View style={styles.headerText}>
        <Text testID="match-card-competition" variant="state" style={styles.quiet}>
          {context.competition}
        </Text>
        {where === null ? null : (
          <Text testID="match-card-where" variant="body" style={styles.ink}>
            {where}
          </Text>
        )}
      </View>
      {match === null ? null : (
        <View testID="match-card-match" style={styles.plate}>
          <Text variant="state" style={styles.ink}>
            {match}
          </Text>
        </View>
      )}
    </View>
  );
});

/**
 * The sides, a row each with the match label's bar (C2: lime first, lilac second), the names large and as typed,
 * partners wrapping, never cut. The v between them is drawn only: a screen reader hears the block once, "A. Sharma
 * versus L. Chen".
 */
const Versus = memo(function Versus({
  first,
  second,
}: {
  readonly first: string;
  readonly second: string;
}) {
  const { t } = useT();
  return (
    <View
      testID="match-card-versus"
      accessible
      accessibilityLabel={t('scoring.details.versus', { first, second })}
      style={styles.versus}
    >
      <Side name={first} side="first" />
      <Text testID="match-card-v" variant="metricUnit" aria-hidden style={styles.v}>
        {SIDES.trim()}
      </Text>
      <Side name={second} side="second" />
    </View>
  );
});

const Side = memo(function Side({
  name,
  side,
}: {
  readonly name: string;
  readonly side: 'first' | 'second';
}) {
  return (
    <View testID="match-card-side" style={styles.side}>
      <View {...barMarker(side)} style={side === 'first' ? firstBar : secondBar} />
      <NameText testID="match-card-name" variant="matchName" style={styles.name}>
        {name}
      </NameText>
    </View>
  );
});

/** "Rules", then a row a rule, a hairline between rows. The label column is the widest label's (`useLabelColumn`). */
const RulesTable = memo(function RulesTable({ rows }: { readonly rows: readonly MatchCardRow[] }) {
  const { t } = useT();
  const [column, onLabelLayout] = useLabelColumn();
  return (
    <View testID="match-card-rules">
      <Text variant="state" accessibilityRole="header" style={styles.quiet}>
        {t('scoring.rules.heading')}
      </Text>
      {rows.map((row, at) => (
        <RuleRow key={at} row={row} ruled={at > 0} column={column} onLabelLayout={onLabelLayout} />
      ))}
    </View>
  );
});

/** A rule, heard as one line: "Format: Best of 3 games". The value wraps under itself. */
const RuleRow = memo(function RuleRow({
  row,
  ruled,
  column,
  onLabelLayout,
}: {
  readonly row: MatchCardRow;
  readonly ruled: boolean;
  readonly column: StyleProp<ViewStyle>;
  readonly onLabelLayout: (event: LayoutChangeEvent) => void;
}) {
  const { t } = useT();
  return (
    <View
      testID="match-card-row"
      accessible
      accessibilityLabel={t('scoring.rules.row', { label: row.label, value: row.value })}
      style={ruled ? ruledRow : styles.row}
    >
      <View
        testID="match-card-label-cell"
        onLayout={onLabelLayout}
        style={[styles.labelCell, column]}
      >
        <Text testID="match-card-label" variant="body" style={styles.quiet}>
          {row.label}
        </Text>
      </View>
      <Text testID="match-card-value" variant="body" style={styles.value}>
        {row.value}
      </Text>
    </View>
  );
});

/**
 * The label column: every label's cell at least as wide as the widest laid out, rounded up, and at most
 * `padRuleLabelMax` (the cell's own cap, where a longer label wraps). A cell laid out again reports the column's own
 * width, so the column never narrows; a new table (the caller's key) starts again. It grows only for a report more
 * than half a dp over the column: Fabric snaps a layout to whole pixels, so on a fractional density a cell reports up
 * to half a pixel more than it did, and growing for that would add a dp a pass up to the cap. Until the phone lays the
 * labels out, each cell is its own label's width. As a stylesheet made once per width: never an inline style object.
 */
function useLabelColumn() {
  const [widest, setWidest] = useState(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    const width = event.nativeEvent.layout.width;
    setWidest((was) => (width > was + SNAP ? Math.ceil(width) : was));
  }, []);
  const column = useMemo(
    () => StyleSheet.create({ column: { minWidth: widest } }).column,
    [widest],
  );
  return [column, onLayout] as const;
}

/** The most a layout reported again can differ by from snapping to whole pixels, in dp (`useLabelColumn`). */
const SNAP = 0.5;

/**
 * The test markers. react-native-web renders `dataSet` as `data-*` attributes, which tests read; native ignores it.
 * React Native's own types leave `dataSet` out, hence the cast.
 */
const barMarker = (side: string) => ({ testID: 'match-card-bar', dataSet: { side } }) as ViewProps;

const styles = StyleSheet.create({
  card: { gap: space.md },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  headerText: { flex: 1, gap: space.xs },
  quiet: { color: colour.ink2 },
  // `state` carries no colour (Fabric's default is black) and `body` is ink2: the facts are in ink.
  ink: { color: colour.ink },
  plate: {
    maxWidth: layout.padMatchPlateMax,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderWidth: layout.iconBorder,
    borderColor: colour.ink3,
    borderRadius: radius.card,
  },
  versus: {
    gap: space.xs,
    padding: space.md,
    borderRadius: radius.card,
    backgroundColor: colour.surface2,
  },
  side: { flexDirection: 'row', gap: layout.labelBarGap },
  bar: { width: layout.labelBar },
  barFirst: { backgroundColor: colour.lime },
  barSecond: { backgroundColor: colour.ink3 },
  name: { flex: 1 },
  // The v under the names' first letters: past the bar and its gap.
  v: { color: colour.ink2, marginLeft: layout.labelBar + layout.labelBarGap },
  row: { flexDirection: 'row', gap: space.md, paddingVertical: space.sm },
  ruled: { borderTopWidth: layout.cardBorder, borderTopColor: colour.rule },
  labelCell: { flexShrink: 0, maxWidth: layout.padRuleLabelMax },
  value: { flex: 1, color: colour.ink },
});

const firstBar = [styles.bar, styles.barFirst];
const secondBar = [styles.bar, styles.barSecond];
const ruledRow = [styles.row, styles.ruled];
