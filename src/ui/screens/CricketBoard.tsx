import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type {
  BoardResult,
  BoardScore,
  CreaseLine,
  CricketBoardView,
} from '@/domain/scoring/cricketPad';
import type { SummaryBlock } from '@/domain/scoring/cricketSummary';
import type { CricketBowler, OverChip } from '@/domain/scoring/cricketTypes';
import { useT } from '@/hooks/useLanguage';
import { usePadText } from '@/hooks/usePadText';
import { Text } from '@/ui/components/Text';
import { boardSpare, chipsShown, fitBoard, spareSpacers } from '@/ui/screens/cricketBoardFit';
import { colour, layout, space } from '@/ui/theme/tokens';

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
  const [box, setBox] = useState<{ readonly width: number; readonly height: number } | null>(null);
  const measured = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setBox((was) => (was?.width === width && was.height === height ? was : { width, height }));
  }, []);
  // The room is what the keys leave: the board is the flex region above them, so its own height is measured, never the
  // screen's class (T19 fix 5, Part 3). Less than it needs, it gives way rung by rung (`fitBoard`).
  const room = box?.height ?? null;
  const width = box?.width ?? null;
  const done = view.result !== null;
  const freeHit = view.status !== null;
  const fit = useMemo(() => fitBoard(room, done, freeHit), [room, done, freeHit]);
  // Spare height goes in two spacers, a little above the score and the rest under the strip (T19 fix 8); none spare, the top
  // stays and the bottom clips.
  const spacers = spareSpacers(boardSpare(room, fit, done, freeHit), fit.gap);
  const shown = chipsShown(view.over?.chips.length ?? 0, width, done);
  const tight = fit.gap === layout.boardGapTight;
  return (
    <View
      testID="cricket-board"
      onLayout={measured}
      style={tight ? styles.boardTight : styles.board}
    >
      {spacers.top ? <View testID="board-spare" style={styles.spare} /> : null}
      {view.result === null ? (
        <ScorePanel
          score={view.score}
          onOpenPlayers={onOpenPlayers}
          chaseJoined={fit.chaseJoined}
          compact={fit.compact}
        />
      ) : (
        <ResultPanel result={view.result} />
      )}
      <Crease crease={view.crease} bowler={view.bowler} onOpenPlayers={onOpenPlayers} />
      <FreeHit status={view.status} />
      {fit.strip && view.over !== null ? <OverStrip over={view.over} shown={shown} /> : null}
      <Summary summary={view.summary} />
      {spacers.bottom ? <View testID="board-spare-end" style={styles.spareEnd} /> : null}
    </View>
  );
});

/**
 * Runs/wickets large in lime with the overs beside them, then the innings and the chase: nothing before an innings is due.
 * With Players offered, a tap on it opens Players too (spec §4.8a: "the score, the crease, the bowler line"). Only the
 * crease is the button a screen reader names "Players", so the score is still read as the score. Over totals draws it
 * alone, over the entry (Task 17), with no Players to open.
 */
export const ScorePanel = memo(function ScorePanel({
  score,
  onOpenPlayers,
  chaseJoined = false,
  compact = false,
}: {
  readonly score: BoardScore | null;
  readonly onOpenPlayers?: () => void;
  /** The last rung of giving way (`fitBoard`): the chase shares the innings line, and the panel is a line shorter. */
  readonly chaseJoined?: boolean;
  /** The last rung: the score in a smaller face, the panel shorter still. */
  readonly compact?: boolean;
}) {
  let panel: PanelStyle = chaseJoined ? styles.scoreJoined : styles.score;
  if (compact) panel = styles.scoreCompact;
  if (score === null) return <View testID="board-score" style={panel} />;
  if (onOpenPlayers === undefined)
    return (
      <View testID="board-score" style={panel}>
        <ScoreLines score={score} chaseJoined={chaseJoined} compact={compact} />
      </View>
    );
  return (
    <Pressable testID="board-score" accessible={false} onPress={onOpenPlayers} style={panel}>
      <ScoreLines score={score} chaseJoined={chaseJoined} compact={compact} />
    </Pressable>
  );
});

function ScoreLines({
  score,
  chaseJoined,
  compact,
}: {
  readonly score: BoardScore;
  readonly chaseJoined: boolean;
  readonly compact: boolean;
}) {
  const words = usePadText();
  const { t } = useT();
  return (
    <>
      <View style={styles.head}>
        <TeamName team={score.team} testID="board-team" />
        <View style={styles.scoreLine}>
          <Text
            variant={compact ? 'tally' : 'scoreCompact'}
            testID="board-runs"
          >{`${score.runs}/${score.wickets}`}</Text>
          <Text variant="label" testID="board-overs" style={styles.overs}>
            {t('scoring.cricket.board.overs', { overs: score.overs })}
          </Text>
        </View>
      </View>
      {chaseJoined ? (
        <Text
          variant="control"
          testID="board-innings"
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={layout.boardTeamMinScale}
          ellipsizeMode="tail"
          style={styles.chase}
        >
          {score.chase === null
            ? words(score.innings)
            : t('scoring.cricket.board.joined', {
                innings: words(score.innings),
                chase: words(score.chase),
              })}
        </Text>
      ) : (
        <>
          <Text variant="control" testID="board-innings" numberOfLines={1} style={styles.innings}>
            {words(score.innings)}
          </Text>
          <Text variant="control" testID="board-chase" numberOfLines={1} style={styles.chase}>
            {score.chase === null ? '' : words(score.chase)}
          </Text>
        </>
      )}
    </>
  );
}

/**
 * The batting team's name: one line that shrinks to fit down to `layout.boardTeamMinScale`, then ends in an ellipsis
 * (owner, 2026-11-10). Mixed case, as the organiser typed it (AGENTS.md §5's exception for names). The shrinking is
 * native's: jsdom shows only the one line.
 */
const TeamName = memo(function TeamName({
  team,
  testID,
  beside = false,
}: {
  readonly team: string;
  readonly testID: string;
  readonly beside?: boolean;
}) {
  return (
    <Text
      variant="label"
      testID={testID}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={layout.boardTeamMinScale}
      ellipsizeMode="tail"
      style={beside ? styles.teamBeside : styles.team}
    >
      {team}
    </Text>
  );
});

/**
 * A result's two scores (T19 fix 5, Part 2): a row a side, the side that batted first on top, its name shrinking to fit
 * and its runs/wickets with the overs on the right.
 */
const ResultPanel = memo(function ResultPanel({ result }: { readonly result: BoardResult }) {
  const { t } = useT();
  return (
    <View testID="board-result" style={styles.result}>
      {result.map((row, index) => (
        <View
          key={index}
          testID={index === 0 ? 'board-result-first' : 'board-result-second'}
          style={styles.resultRow}
        >
          <TeamName team={row.team} testID="board-result-team" beside />
          <Text variant="metricValue" testID="board-result-figures" style={styles.resultFigures}>
            {row.overs === null
              ? row.figures
              : `${row.figures} ${t('scoring.cricket.board.overs', { overs: row.overs })}`}
          </Text>
        </View>
      ))}
    </View>
  );
});

/**
 * A result's summary (T19 fix 10): a block a main innings, in batting order, with the side's name, its top bat, the other
 * side's best bowl and the extras. Read only, every row a fixed height (`layout.creaseRow`) so nothing moves, no rung of
 * giving way: the board's own clip cuts what the room does not hold, at the bottom, and never draws over anything. A row
 * with nothing to say (no ball faced, none bowled, over totals) is left out.
 */
const Summary = memo(function Summary({
  summary,
}: {
  readonly summary: readonly SummaryBlock[] | null;
}) {
  if (summary === null) return null;
  return (
    <View testID="board-summary" style={styles.summary}>
      {summary.map((block, index) => (
        <SummaryBlockView key={index} block={block} />
      ))}
    </View>
  );
});

const SummaryBlockView = memo(function SummaryBlockView({
  block,
}: {
  readonly block: SummaryBlock;
}) {
  const words = usePadText();
  const { t } = useT();
  const { top, best } = block;
  return (
    <View testID="summary-block" style={styles.summaryBlock}>
      <Text
        variant="label"
        testID="summary-team"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={layout.boardTeamMinScale}
        ellipsizeMode="tail"
        style={styles.summaryTeam}
      >
        {block.team}
      </Text>
      {top === null ? null : (
        <SummaryRow
          testID="summary-top"
          label={t('scoring.cricket.board.summary.top')}
          name={top.name}
          figures={`${top.runs} (${top.balls})`}
        />
      )}
      {best === null ? null : (
        <SummaryRow
          testID="summary-best"
          label={t('scoring.cricket.board.summary.best')}
          name={best.name}
          figures={`${best.wickets}-${best.runs} (${best.overs})`}
        />
      )}
      {block.extras === null ? null : (
        <View style={styles.summaryRow}>
          <Text
            variant="metricUnit"
            testID="summary-extras"
            numberOfLines={1}
            ellipsizeMode="tail"
            style={styles.summaryLabel}
          >
            {words(block.extras)}
          </Text>
        </View>
      )}
    </View>
  );
});

/** One row: its label, the name (one line, an ellipsis) and the figures; a screen reader reads it as one line. */
const SummaryRow = memo(function SummaryRow({
  testID,
  label,
  name,
  figures,
}: {
  readonly testID: string;
  readonly label: string;
  readonly name: string;
  readonly figures: string;
}) {
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={`${label}, ${name}, ${figures}`}
      style={styles.summaryRow}
    >
      <Text variant="metricUnit" numberOfLines={1} style={styles.summaryTag}>
        {label}
      </Text>
      <Text
        variant="label"
        testID={`${testID}-name`}
        numberOfLines={1}
        ellipsizeMode="tail"
        style={styles.summaryName}
      >
        {name}
      </Text>
      <Text variant="metricValue" testID={`${testID}-figures`} style={styles.figures}>
        {figures}
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
  readonly crease: CricketBoardView['crease'];
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

/**
 * "Over 3", and the over's deliveries in order, each chip one width. With keys under the board only the last `shown` show,
 * and the label says what is hidden: "Over 3 · last 6 of 10".
 */
const OverStrip = memo(function OverStrip({
  over,
  shown,
}: {
  readonly over: NonNullable<CricketBoardView['over']>;
  readonly shown: number;
}) {
  const { t } = useT();
  const total = over.chips.length;
  const chips = shown < total ? over.chips.slice(total - shown) : over.chips;
  return (
    <View testID="board-over" style={styles.over}>
      <View style={styles.overHead}>
        <Text variant="metricUnit" style={styles.overLabel}>
          {shown < total
            ? t('scoring.cricket.board.overLast', { number: over.number, shown, total })
            : t('scoring.cricket.board.over', { number: over.number })}
        </Text>
      </View>
      <View testID="board-chips" style={styles.chips}>
        {chips.map((chip, index) => (
          <Chip key={total - chips.length + index} chip={chip} />
        ))}
      </View>
    </View>
  );
});

/**
 * A free hit due: the rule cue the scorer needs for the next ball, so it is the board's own line and is never dropped when
 * the board gives way (T19 fix 5, round 1; the chip strip above it may hide). Nothing is drawn, and no height is asked,
 * when none is due.
 */
const FreeHit = memo(function FreeHit({ status }: { readonly status: CricketBoardView['status'] }) {
  const words = usePadText();
  if (status === null) return null;
  return (
    <Text
      variant="metricUnit"
      testID="board-status"
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={layout.boardTeamMinScale}
      ellipsizeMode="tail"
      style={styles.status}
    >
      {words(status)}
    </Text>
  );
});

const Chip = memo(function Chip({ chip }: { readonly chip: OverChip }) {
  const wicket = chip.tone === 'wicket';
  return (
    <View testID="over-chip" style={wicket ? styles.chipWicket : styles.chip}>
      <Text variant="metricValue" testID="over-chip-text" style={TONE[chip.tone]}>
        {chip.text}
      </Text>
    </View>
  );
});

type PanelStyle = (typeof styles)['score' | 'scoreJoined' | 'scoreCompact'];

const styles = StyleSheet.create({
  // The board is the room the keys leave: clipped at its own bottom, so what cannot fit is cut and never drawn over them.
  board: { flex: 1, gap: space.sm, overflow: 'hidden' },
  // Spare height above the score (owner, 2026-11-10): at most `space.md` of it, shrinks to nothing when the board is taller
  // than the model thought, so any overflow clips the bottom and the top is never cut.
  spare: { flexGrow: 1, flexShrink: 1, maxHeight: space.md },
  // What the top spacer's cap leaves goes under the strip, against the keys (T19 fix 8).
  spareEnd: { flexGrow: 1, flexShrink: 1 },
  boardTight: { flex: 1, gap: layout.boardGapTight, overflow: 'hidden' },
  // Every region keeps its height (`flexShrink: 0`): a board too short clips at its own bottom and never squeezes a row
  // (T19 fix 6, device: the crease rows measured 16 dp, not 25, and the bowler line was cut mid-glyph).
  score: { height: layout.scorePanel, gap: space.xs, overflow: 'hidden', flexShrink: 0 },
  scoreJoined: {
    height: layout.scorePanelJoined,
    gap: space.xs,
    overflow: 'hidden',
    flexShrink: 0,
  },
  scoreCompact: {
    height: layout.scorePanelCompact,
    gap: space.xs,
    overflow: 'hidden',
    flexShrink: 0,
  },
  head: { gap: 0 },
  summary: { gap: space.xs, flexShrink: 0 },
  summaryBlock: { gap: 0, flexShrink: 0 },
  summaryTeam: { color: colour.ink2, height: layout.creaseRow, flexShrink: 0 },
  summaryRow: {
    height: layout.creaseRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    flexShrink: 0,
  },
  summaryTag: { color: colour.ink3, flexShrink: 0 },
  summaryName: { flex: 1, color: colour.ink },
  summaryLabel: { color: colour.ink2, flex: 1 },
  team: { color: colour.ink },
  teamBeside: { flex: 1, color: colour.ink },
  resultFigures: { color: colour.ink, flexShrink: 0 },
  result: { height: layout.resultPanel, gap: space.xs, overflow: 'hidden', flexShrink: 0 },
  resultRow: {
    height: layout.creaseRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    flexShrink: 0,
  },
  scoreLine: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  // A fixed box that never shrinks (T19 D1): the whole over's shorter text was cut on the phone in a box of its own
  // width.
  overs: { minWidth: layout.boardOvers, flexShrink: 0, color: colour.ink2 },
  innings: { color: colour.ink2 },
  chase: { color: colour.ink },
  crease: { gap: 0, flexShrink: 0 },
  row: {
    height: layout.creaseRow,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    flexShrink: 0,
  },
  mark: { width: space.md, alignItems: 'center' },
  dot: { color: colour.lime },
  name: { flex: 1, color: colour.ink },
  bowler: { flex: 1, color: colour.ink2 },
  figures: { color: colour.ink },
  // At least one row of chips tall; an over that wraps makes it taller, and the strip is the board's last region.
  over: { minHeight: layout.overStrip, gap: space.xs, flexShrink: 0 },
  overHead: { flexDirection: 'row', justifyContent: 'space-between' },
  overLabel: { color: colour.ink3 },
  status: { color: colour.caution, flexShrink: 0 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: {
    minWidth: layout.overChip,
    height: layout.overChip,
    paddingHorizontal: space.xs,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: space.xs,
    backgroundColor: colour.surface2,
  },
  chipWicket: {
    minWidth: layout.overChip,
    height: layout.overChip,
    paddingHorizontal: space.xs,
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
