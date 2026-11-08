import type { CricketResult, CricketResultKey, CricketSide } from '@/domain/scoring/cricketTypes';
import type { PadSide, PadText } from '@/domain/scoring/padView';

type Text = PadText<CricketResultKey>;

/**
 * A decided match in words (S2-4 spec §4.7), the web's own sentences (`matchCentre.result.*`): the engine's margin when it
 * was won on the field ("Home CC won by 12 runs", "won by 4 wickets", "won by an innings and 30 runs", "won on the super
 * over", "won on boundary count"), else the outcome's kind (a tie, a draw, no result, an award, a double walkover, or a win
 * with no margin). The fold's `headline` is a score line, never these words. The winner is named by the side's name as the
 * organiser typed it.
 */
export function cricketResultWords(
  result: CricketResult,
  sides: Readonly<Record<PadSide, CricketSide>>,
): Text {
  const name = result.winner === null ? '' : sides[result.winner].name;
  const how = result.margin;
  switch (how.kind) {
    case 'runs':
    case 'wickets':
    case 'innings_and_runs':
      return { key: `scoring.cricket.result.${how.kind}.other`, count: how.value, vars: { name } };
    case 'super_over':
    case 'boundary_count':
    case 'win':
    case 'award':
      return { key: `scoring.cricket.result.${how.kind}`, vars: { name } };
    case 'tie':
    case 'draw':
    case 'no_result':
    case 'double_walkover':
      return { key: `scoring.cricket.result.${how.kind}` };
  }
}
