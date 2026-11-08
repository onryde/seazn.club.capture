import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { BoardScore, CreaseLine, CricketBoardView } from '@/domain/scoring/cricketPad';
import type { CricketBowler, OverChip } from '@/domain/scoring/cricketTypes';
import { useT } from '@/hooks/useLanguage';
import { usePadText } from '@/hooks/usePadText';
import { Text } from '@/ui/components/Text';
import { colour, layout, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

/**
 * The cricket board (S2-4 spec §5 rows 2 to 4; plan Task 8), drawn in the pad's halves' place (`PadContent`'s `body`): the
 * score in lime with the overs, the innings and the chase; the crease, the striker first with the lime dot, each batter's
 * runs (balls); the bowler with O-M-R-W; and this over's deliveries as chips of one width, extras in the caution colour.
 * Every region has a fixed height (`layout.scorePanel`, `creaseRow`, `overStrip`), so nothing moves as an over fills, a
 * wicket falls or a chase starts. Read only: a tap on the crease opens Players when the screen offers it (Task 14).
 */
export const CricketBoard = memo(function CricketBoard({
  view,
  onOpenPlayers,
}: {
  readonly view: CricketBoardView;
  readonly onOpenPlayers?: () => void;
}) {
  return (
    <View testID="cricket-board" style={styles.board}>
      <ScorePanel score={view.score} />
      <Crease crease={view.crease} bowler={view.bowler} onOpenPlayers={onOpenPlayers} />
      <OverStrip over={view.over} status={view.status} />
    </View>
  );
});

/** Runs/wickets large in lime with the overs beside them, then the innings and the chase: nothing before an innings is due. */
const ScorePanel = memo(function ScorePanel({ score }: { readonly score: BoardScore | null }) {
  const words = usePadText();
  const { t } = useT();
  if (score === null) return <View testID="board-score" style={styles.score} />;
  return (
    <View testID="board-score" style={styles.score}>
      <View style={styles.scoreLine}>
        <Text variant="scoreCompact" testID="board-runs">{`${score.runs}/${score.wickets}`}</Text>
        <Text variant="label" testID="board-overs" style={styles.overs}>
          {t('scoring.cricket.board.overs', { overs: score.overs })}
        </Text>
      </View>
      <Text variant="control" testID="board-innings" numberOfLines={1} style={styles.innings}>
        {words(score.innings)}
      </Text>
      <Text variant="control" testID="board-chase" numberOfLines={1} style={styles.chase}>
        {score.chase === null ? '' : words(score.chase)}
      </Text>
    </View>
  );
});

/** The two batters (striker first) and the bowler, a fixed row each, empty until they are picked. */
const Crease = memo(function Crease({
  crease,
  bowler,
  onOpenPlayers,
}: {
  readonly crease: readonly [CreaseLine, CreaseLine] | null;
  readonly bowler: CricketBowler | null;
  readonly onOpenPlayers?: () => void;
}) {
  const { t } = useT();
  const rows = (
    <>
      <BatterRow line={crease?.[0] ?? null} testID="board-batter-first" />
      <BatterRow line={crease?.[1] ?? null} testID="board-batter-second" />
      <BowlerRow bowler={bowler} />
    </>
  );
  if (onOpenPlayers === undefined) {
    return (
      <View testID="board-crease" style={styles.crease}>
        {rows}
      </View>
    );
  }
  return (
    <Pressable
      testID="board-crease"
      accessibilityRole="button"
      accessibilityLabel={t('scoring.cricket.rules.players.label')}
      onPress={onOpenPlayers}
      style={styles.crease}
    >
      {rows}
    </Pressable>
  );
});

/** A batter: the lime dot when on strike, the name (an ellipsis before it ever wraps), then "runs (balls)". */
const BatterRow = memo(function BatterRow({
  line,
  testID,
}: {
  readonly line: CreaseLine | null;
  readonly testID: string;
}) {
  const { t } = useT();
  if (line === null) return <View testID={testID} style={styles.row} />;
  return (
    <View testID={testID} style={styles.row}>
      <View style={styles.mark}>
        {line.striker ? (
          <Text
            variant="label"
            testID="on-strike"
            accessibilityLabel={t('scoring.cricket.board.onStrike')}
            style={styles.dot}
          >
            ●
          </Text>
        ) : null}
      </View>
      <Text variant="label" numberOfLines={1} style={styles.name}>
        {line.name}
      </Text>
      <Text variant="metricValue" style={styles.figures}>{`${line.runs} (${line.balls})`}</Text>
    </View>
  );
});

/** The bowler of the over, with O-M-R-W; an empty row until one is picked. */
const BowlerRow = memo(function BowlerRow({ bowler }: { readonly bowler: CricketBowler | null }) {
  if (bowler === null) return <View testID="board-bowler" style={styles.row} />;
  return (
    <View testID="board-bowler" style={styles.row}>
      <View style={styles.mark} />
      <Text variant="label" numberOfLines={1} style={styles.bowler}>
        {bowler.name}
      </Text>
      <Text variant="metricValue" style={styles.figures}>
        {bowler.figures}
      </Text>
    </View>
  );
});

/** "Over 3", a free hit when one is due, and the over's deliveries in order, each chip one width. */
const OverStrip = memo(function OverStrip({
  over,
  status,
}: {
  readonly over: CricketBoardView['over'];
  readonly status: CricketBoardView['status'];
}) {
  const { t } = useT();
  const words = usePadText();
  return (
    <View testID="board-over" style={styles.over}>
      <View style={styles.overHead}>
        <Text variant="metricUnit" style={styles.overLabel}>
          {t('scoring.cricket.board.over', { number: over.number })}
        </Text>
        {status === null ? null : (
          <Text variant="metricUnit" testID="board-status" style={styles.status}>
            {words(status)}
          </Text>
        )}
      </View>
      <ScrollView horizontal testID="board-chips" contentContainerStyle={styles.chips}>
        {over.chips.map((chip, index) => (
          <Chip key={index} chip={chip} />
        ))}
      </ScrollView>
    </View>
  );
});

const Chip = memo(function Chip({ chip }: { readonly chip: OverChip }) {
  const wicket = chip.tone === 'wicket';
  return (
    <View testID="over-chip" style={wicket ? styles.chipWicket : styles.chip}>
      <Text variant="controlSmall" style={TONE[chip.tone]}>
        {chip.text}
      </Text>
    </View>
  );
});

/** A chip's height: the strip less its label line and the gap under it. */
const CHIP_HEIGHT = layout.overStrip - typeScale.metricUnit.lineHeight - space.xs;

const styles = StyleSheet.create({
  board: { flex: 1, gap: space.sm },
  score: { height: layout.scorePanel, gap: space.xs, overflow: 'hidden' },
  scoreLine: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  overs: { color: colour.ink2 },
  innings: { color: colour.ink2 },
  chase: { color: colour.ink },
  crease: { gap: 0 },
  row: {
    height: layout.creaseRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  mark: { width: space.md, alignItems: 'center' },
  dot: { color: colour.lime },
  name: { flex: 1, color: colour.ink },
  bowler: { flex: 1, color: colour.ink2 },
  figures: { color: colour.ink },
  over: { height: layout.overStrip, gap: space.xs },
  overHead: { flexDirection: 'row', justifyContent: 'space-between' },
  overLabel: { color: colour.ink3 },
  status: { color: colour.caution },
  chips: { flexDirection: 'row', gap: space.xs },
  chip: {
    width: layout.overChip,
    height: CHIP_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: space.xs,
    backgroundColor: colour.surface2,
  },
  chipWicket: {
    width: layout.overChip,
    height: CHIP_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: space.xs,
    backgroundColor: colour.ink,
  },
});

/** A chip's word: a dot inert, runs in ink, a boundary in lime, an extra in the caution colour, a wicket in night on cream. */
const TONE = StyleSheet.create({
  dot: { color: colour.ink3 },
  run: { color: colour.ink },
  boundary: { color: colour.lime },
  extra: { color: colour.caution },
  wicket: { color: colour.ground },
});
