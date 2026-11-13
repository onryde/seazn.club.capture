import { memo } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { PadFinalBox, PadScoreboard } from '@/domain/scoring/padView';
import { usePadText } from '@/hooks/usePadText';
import type { MessageKey } from '@/i18n/messages';
import { CallPlate } from '@/ui/components/CallPlate';
import { Text } from '@/ui/components/Text';
import { colour, layout, plateInk, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

/**
 * The pad half's tennis rows (S2-7 Task 18; rulings 235, 239, 240), `ScoreHalf`'s parts in a file of their own: the server's
 * line under the names, one row of a scoreboard with the dots of the games won on it, and the final board. All drawings: a
 * screen reader hears their words in the half's name (`PadScoreboard.said`, `PadFinalBoard.said`), so each is hidden from it.
 */

type Board = PadScoreboard<MessageKey>;
type FinalBox = PadFinalBox<MessageKey>;

/**
 * The room a scoreboard half's rows take beyond the one bottom row `halfNeeds` counts, for the score's size (`scoreRole`): the
 * server's line, and the row as laid out where it is taller than that row. The row's height is the phone's own measure
 * (`ScoreboardRow`'s `onLayout`), so dots that wrap to a second or third line (twelve beside four set boxes at 320 dp, ruling
 * 242) take room from the score; before it is measured the row is one line.
 */
export function boardRoom(
  board: Board | null | undefined,
  serverShown: boolean,
  rowHeight: number | null = null,
): number {
  const server = serverShown ? typeScale.control.lineHeight : 0;
  if (board === null || board === undefined) return server;
  const bottom = Math.max(typeScale.control.lineHeight, typeScale.metricUnit.lineHeight);
  return server + Math.max(0, (rowHeight ?? typeScale.boardScore.lineHeight) - bottom);
}

/** The server's name under the side's names, the serving ball before it: one line, cut with an ellipsis rather than wrapped. */
export const ServerLine = memo(function ServerLine({ words }: { readonly words: string }) {
  return (
    <View testID="server" aria-hidden style={styles.server}>
      <View style={styles.ball} />
      <Text variant="control" numberOfLines={1} style={styles.serverWords}>
        {words}
      </Text>
    </View>
  );
});

/**
 * The scoreboard's row (rulings 240, 242), one line while it fits: "Sets", a dark box for each set over, then the numbered dots
 * of the games this side won in the set under way (the games count), then the call on the next point (break, set or match
 * point) when there is one, then the hint at the end, which gives way first (an
 * ellipsis, down to nothing). Dots that do not fit beside the boxes wrap to a second line rather than shrink below `padDot`.
 * With nothing to show the row keeps one box's height, so the first dot moves nothing.
 */
export const ScoreboardRow = memo(function ScoreboardRow({
  board,
  call,
  hint,
  onHeight,
}: {
  readonly board: Board;
  /** The half's call on its next point (break, set or match point): a lime plate after the dots, before the hint. */
  readonly call: string | null;
  readonly hint: string | null;
  /** The row's height as laid out, for the score's size (`boardRoom`). */
  readonly onHeight: (event: LayoutChangeEvent) => void;
}) {
  const words = usePadText();
  return (
    <View testID="scoreboard" aria-hidden style={styles.row} onLayout={onHeight}>
      <View style={styles.items}>
        {board.sets.length === 0 ? null : (
          <>
            <Text variant="boardLabel" style={styles.label}>
              {words(board.setsLabel)}
            </Text>
            {board.sets.map((games, at) => (
              // A finished set's place is its identity: sets are only ever added at the end.
              <View key={at} testID="board-set" style={styles.darkBox}>
                <Text variant="boardScore" style={styles.darkDigits}>
                  {games}
                </Text>
              </View>
            ))}
          </>
        )}
        {(board.dots ?? NO_DOTS).map((game) => (
          // A game's number is its identity.
          <View key={game} testID="game-dot" style={styles.dot}>
            <Text variant="dotNumber" style={styles.dotDigits}>
              {game}
            </Text>
          </View>
        ))}
        {call === null ? null : <CallPlate words={call} />}
      </View>
      {hint === null ? null : (
        <Text variant="metricUnit" numberOfLines={1} style={styles.hint}>
          {hint}
        </Text>
      )}
    </View>
  );
});

const NO_DOTS: readonly number[] = [];

/**
 * The final board (ruling 239) in the half's middle: a box for each set with its small label above, then the sets won. The
 * winner's sets in lime, its Sets box a lime plate with night ink, the rest plain; a tie-break set's loser carries its
 * tie-break points small, in brackets.
 */
export const FinalBoard = memo(function FinalBoard({
  boxes,
}: {
  readonly boxes: readonly FinalBox[];
}) {
  const words = usePadText();
  return (
    <View testID="final-board" aria-hidden style={styles.final}>
      {boxes.map((box, at) => (
        // A box's place is its identity: the board is read once, left to right.
        <View key={at} style={box.bracket === undefined ? styles.column : styles.columnBracket}>
          <Text variant="boardLabel" style={[styles.label, styles.centred]}>
            {words(box.label)}
          </Text>
          <View testID="final-box" style={[styles.finalBox, plateOf[box.tone]]}>
            <Text variant="finalScore" style={inkOf[box.tone]}>
              {box.value}
            </Text>
            {box.bracket === undefined ? null : (
              <Text testID="final-bracket" variant="boardScore" style={styles.bracket}>
                {`(${box.bracket})`}
              </Text>
            )}
          </View>
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  server: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // The serving ball: a small lime disc (a drawing, not a status).
  ball: {
    width: layout.padBall,
    height: layout.padBall,
    borderRadius: layout.padBall / 2,
    backgroundColor: colour.lime,
  },
  serverWords: { flexShrink: 1, color: colour.ink2 },
  // The items wrap (the dots, past the boxes); the hint keeps its place at the right and gives way first.
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  items: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.xs,
    // Wrapped dot lines stand one dot gap apart, so a third line costs 22 dp, not 24.
    rowGap: layout.padDotGap,
    minHeight: typeScale.boardScore.lineHeight,
  },
  label: { flexShrink: 0, color: colour.ink3 },
  darkBox: {
    flexShrink: 0,
    minWidth: layout.padBoardBox,
    alignItems: 'center',
    borderRadius: layout.iconBorder * 4,
    paddingHorizontal: space.xs,
    backgroundColor: colour.surface2,
  },
  darkDigits: { color: colour.ink },
  hint: { flexShrink: 1, textAlign: 'right', color: colour.ink3, alignSelf: 'center' },
  dot: {
    width: layout.padDot,
    height: layout.padDot,
    borderRadius: layout.padDot / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colour.lime,
  },
  dotDigits: { color: plateInk },
  // Boxes share their line's width (each starts at its basis and grows to its max); a board of more than a line holds wraps.
  final: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: space.xs,
  },
  column: {
    flexGrow: 1,
    flexBasis: layout.padFinalBox,
    maxWidth: layout.padFinalBoxMax,
    alignItems: 'stretch',
    gap: space.xs,
  },
  columnBracket: {
    flexGrow: 1,
    flexBasis: layout.padFinalBoxBracket,
    maxWidth: layout.padFinalBoxMax,
    alignItems: 'stretch',
    gap: space.xs,
  },
  finalBox: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
    borderRadius: layout.iconBorder * 8,
    backgroundColor: colour.surface2,
  },
  platePlain: { backgroundColor: colour.surface2 },
  platePlate: { backgroundColor: colour.lime },
  inkPlain: { color: colour.ink },
  inkWon: { color: colour.lime },
  inkPlate: { color: plateInk },
  bracket: { color: colour.ink3 },
  centred: { textAlign: 'center' },
});

const plateOf = { won: styles.platePlain, plain: styles.platePlain, plate: styles.platePlate };
const inkOf = { won: styles.inkWon, plain: styles.inkPlain, plate: styles.inkPlate };
