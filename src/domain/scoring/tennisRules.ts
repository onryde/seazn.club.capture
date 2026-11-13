import type { PadRuleRow, PadText } from '@/domain/scoring/padView';
import type { TennisCfg } from '@/domain/scoring/tennisEngine';

/** The dictionary keys the rules table's rows name: a label and a value a row. */
export type TennisRuleKey =
  | 'scoring.tennis.rules.format.label'
  | 'scoring.tennis.rules.bestOf'
  | 'scoring.tennis.rules.set.label'
  | 'scoring.tennis.rules.gamesTo'
  | 'scoring.tennis.rules.tiebreak.label'
  | 'scoring.tennis.rules.tiebreakAt'
  | 'scoring.tennis.rules.noTiebreak'
  | 'scoring.tennis.rules.game.label'
  | 'scoring.tennis.rules.noAd'
  | 'scoring.tennis.rules.finalSet.label'
  | 'scoring.tennis.rules.finalMatchTiebreak'
  | 'scoring.tennis.rules.finalTiebreak';

type Row = PadRuleRow<TennisRuleKey>;
type Value = PadText<TennisRuleKey>;

const row = (name: 'format' | 'set' | 'tiebreak' | 'game' | 'finalSet', value: Value): Row => ({
  label: { key: `scoring.tennis.rules.${name}.label` },
  value,
});

/**
 * The rules table's rows (S2-7 Task 6; ruling 230): Format ("Best of 3"), Set ("Games to 6"), Tie-break ("At 6–6, to 7"), Game
 * ("No-ad", only when the config says so) and Final set (only when it differs from the others: a match tie-break, or a
 * tie-break to its own number). Read from the match's config as the engine reads it; 7.0.0's config has no variant field, so
 * no row names a preset. There is no row about the serve: the phone asks none (ruling 216).
 */
export function tennisRuleRows(cfg: TennisCfg): readonly Row[] {
  const { set } = cfg;
  return [
    row('format', { key: 'scoring.tennis.rules.bestOf', vars: { bestOf: cfg.bestOf } }),
    row('set', { key: 'scoring.tennis.rules.gamesTo', vars: { gamesTo: set.gamesTo } }),
    row('tiebreak', tiebreakOf(cfg)),
    ...(cfg.game.noAd ? [row('game', { key: 'scoring.tennis.rules.noAd' })] : []),
    ...finalSetRow(cfg),
  ];
}

/** "At 6–6, to 7"; an advantage set (the config has no games-all) has none. */
function tiebreakOf({ set }: TennisCfg): Value {
  if (set.tiebreakAt === null) return { key: 'scoring.tennis.rules.noTiebreak' };
  return {
    key: 'scoring.tennis.rules.tiebreakAt',
    vars: { at: set.tiebreakAt, to: set.tiebreakTo },
  };
}

/** The deciding set's own rule: a match tie-break played as the set, or a tie-break at the same games to its own number. */
function finalSetRow(cfg: TennisCfg): readonly Row[] {
  const { finalSet } = cfg;
  // With no tie-break at games-all there is none for the final set to play to its own number.
  if (finalSet === 'same' || cfg.set.tiebreakAt === null) return [];
  if ('matchTiebreakTo' in finalSet) {
    return [
      row('finalSet', {
        key: 'scoring.tennis.rules.finalMatchTiebreak',
        vars: { to: finalSet.matchTiebreakTo },
      }),
    ];
  }
  return [
    row('finalSet', {
      key: 'scoring.tennis.rules.finalTiebreak',
      vars: { at: cfg.set.tiebreakAt, to: finalSet.tiebreakTo },
    }),
  ];
}
