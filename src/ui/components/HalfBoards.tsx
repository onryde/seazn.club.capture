import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { PadFinalBox, PadScoreboard } from '@/domain/scoring/padView';
import { usePadText } from '@/hooks/usePadText';
import type { MessageKey } from '@/i18n/messages';
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
 * server's line, and the row's box where it is taller than that row. Dots that wrap to a second line (twelve beside two set
 * boxes at 320 dp, ruling 242) add a line the score is not told of, which the device check judges.
 */
export function boardRoom(board: Board | null | undefined, serverShown: boolean): number {
  const server = serverShown ? typeScale.control.lineHeight : 0;
  if (board === null || board === undefined) return server;
  const bottom = Math.max(typeScale.control.lineHeight, typeScale.metricUnit.lineHeight);
  return server + Math.max(0, typeScale.boardScore.lineHeight - bottom);
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
 * of the games this side won in the set under way (the games count), then the hint at the end, which gives way first (an
 * ellipsis, down to nothing). Dots that do not fit beside the boxes wrap to a second line rather than shrink below `padDot`.
 * With nothing to show the row keeps one box's height, so the first dot moves nothing.
 */
export const ScoreboardRow = memo(function ScoreboardRow({
  board,
  hint,
}: {
  readonly board: Board;
  readonly hint: string | null;
}) {
  const words = usePadText();
  return (
    <View testID="scoreboard" aria-hidden style={styles.row}>
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
        <View key={at} style={styles.column}>
          <Text variant="boardLabel" style={styles.label}>
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
    gap: space.xs,
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
  final: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space.xs },
  column: { alignItems: 'center', gap: space.xs, flexShrink: 1 },
  finalBox: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    minWidth: layout.padFinalBox,
    maxWidth: layout.padFinalBoxMax,
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
});

const plateOf = { won: styles.platePlain, plain: styles.platePlain, plate: styles.platePlate };
const inkOf = { won: styles.inkWon, plain: styles.inkPlain, plate: styles.inkPlate };
