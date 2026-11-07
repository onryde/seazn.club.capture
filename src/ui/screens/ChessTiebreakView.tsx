import { memo, useCallback, useMemo } from 'react';
import {
  CHESS_ARMAGEDDON_RESULTS,
  CHESS_TIEBREAK_SCORES,
  otherSeat,
} from '@/domain/scoring/chessTypes';
import type { ChessPadActions } from '@/hooks/useChessMatch';
import type { TiebreakView } from '@/hooks/useChessTiebreak';
import { useT } from '@/hooks/useLanguage';
import type { MessageKey } from '@/i18n/messages';
import { TieBreakSheet, type TieBreakChoice } from '@/ui/components/TieBreakSheet';

/**
 * The tie-break sheet of a drawn knockout game (S2-3b Task 2; design §3), drawn from the hook's view: the step on screen
 * (`TiebreakView.step`) says which question to ask and the hook holds every choice. Rapid and blitz: who won (both names),
 * then the optional score with Record; Armageddon: who had Black (both names), how it ended (the players named by colour, so
 * "White won" never asks the scorer to remember a mapping), then the confirm that says who advances, with Record. Record, Cancel
 * and the dim are the hook's.
 */

/** The step's choice for "no score": the score chips are the wire's two and this. */
const NO_SCORE = 'none';

/** The confirm has no choices to pick. */
const NO_PICK = (): void => undefined;

/**
 * A seat and the half that carries its name: the pad's halves, read by what this view needs of them (the view is not a pad,
 * so it does not draw through a `PadView`: `routedApp.drift.test.ts` holds every pad to the screen-on rule).
 */
type Seat = 'first' | 'second';
type Names = Readonly<Record<Seat, string>>;
type HalfName = { readonly side: Seat; readonly label: string };

type StepProps = {
  readonly sheet: TiebreakView;
  readonly halves: readonly HalfName[];
  readonly actions: ChessPadActions;
};

/** The two names, in the seats' places. */
function useNames(halves: readonly HalfName[]): Names {
  return useMemo(
    () => ({
      first: halves.find((half) => half.side === 'first')?.label ?? '',
      second: halves.find((half) => half.side === 'second')?.label ?? '',
    }),
    [halves],
  );
}

export const ChessTiebreakView = memo(function ChessTiebreakView(props: StepProps) {
  switch (props.sheet.step) {
    case 'rung':
      return <RungStep {...props} />;
    case 'winner':
      return <SeatStep {...props} title="scoring.chess.tiebreak.winner.title" />;
    case 'black':
      return <SeatStep {...props} title="scoring.chess.tiebreak.black.title" />;
    case 'score':
      return <ScoreStep {...props} />;
    case 'result':
      return <ResultStep {...props} />;
    case 'confirm':
      return <ConfirmStep {...props} />;
  }
});

/** The sheet around a step's choices: the words that are the same on every step are here. */
function useStep({ actions }: Pick<StepProps, 'actions'>) {
  const { t } = useT();
  return { t, cancelLabel: t('scoring.sheet.cancel'), onCancel: actions.cancelSheet };
}

const RungStep = memo(function RungStep(props: StepProps) {
  const { sheet, actions } = props;
  const { t, cancelLabel, onCancel } = useStep(props);
  const options = useMemo(
    () =>
      sheet.rungs.map((rung) => ({ id: rung, label: t(`scoring.chess.tiebreak.rung.${rung}`) })),
    [sheet.rungs, t],
  );
  const { pickRung } = actions;
  const pick = useCallback(
    (id: string | null) => {
      const rung = sheet.rungs.find((each) => each === id);
      if (rung !== undefined) pickRung(rung);
    },
    [sheet.rungs, pickRung],
  );
  return (
    <TieBreakSheet
      title={t('scoring.chess.tiebreak.rung.title')}
      body={null}
      hint={t('scoring.chess.tiebreak.lotsHint')}
      layout="rows"
      options={options}
      picked={null}
      recordLabel={null}
      cancelLabel={cancelLabel}
      onPick={pick}
      onRecord={actions.recordTiebreak}
      onCancel={onCancel}
    />
  );
});

/** Who won a rapid or blitz tie-break, or who had Black: both players by name, in their seats. */
const SeatStep = memo(function SeatStep(props: StepProps & { readonly title: MessageKey }) {
  const { sheet, halves, actions, title } = props;
  const { t, cancelLabel, onCancel } = useStep(props);
  const names = useNames(halves);
  const options = useMemo<readonly TieBreakChoice[]>(
    () => [
      { id: 'first', label: names.first },
      { id: 'second', label: names.second },
    ],
    [names],
  );
  const { pickTiebreakWinner, pickBlack } = actions;
  const pickSeat = sheet.step === 'black' ? pickBlack : pickTiebreakWinner;
  const pick = useCallback(
    (id: string | null) => {
      if (id === 'first' || id === 'second') pickSeat(id);
    },
    [pickSeat],
  );
  return (
    <TieBreakSheet
      title={t(title)}
      body={null}
      hint={null}
      layout="rows"
      options={options}
      picked={null}
      recordLabel={null}
      cancelLabel={cancelLabel}
      onPick={pick}
      onRecord={actions.recordTiebreak}
      onCancel={onCancel}
    />
  );
});

/** "L. Chen advances · Rapid": who the choices so far send through, and by which rung. */
function useAdvances(sheet: TiebreakView, halves: readonly HalfName[]): string | null {
  const { t } = useT();
  const names = useNames(halves);
  const { advances } = sheet;
  const { rung } = sheet.draft;
  if (advances === null || rung === null) return null;
  return t('scoring.chess.tiebreak.advances', {
    name: names[advances],
    how: t(`scoring.chess.tiebreak.rung.${rung}`),
  });
}

/** The optional score, as chips with No score picked first; Record sends. */
const ScoreStep = memo(function ScoreStep(props: StepProps) {
  const { sheet, halves, actions } = props;
  const { t, cancelLabel, onCancel } = useStep(props);
  const body = useAdvances(sheet, halves);
  const none = t('scoring.chess.tiebreak.score.none');
  const options = useMemo<readonly TieBreakChoice[]>(
    () => [
      { id: NO_SCORE, label: none },
      ...CHESS_TIEBREAK_SCORES.map((score) => ({ id: score, label: score })),
    ],
    [none],
  );
  const { pickScore } = actions;
  // A chip tapped again gives none back; for a score that is not a choice, so a repeat touch changes nothing and the scorer
  // clears a score by picking No score.
  const pick = useCallback(
    (id: string | null) => {
      if (id === NO_SCORE) return pickScore(null);
      const score = CHESS_TIEBREAK_SCORES.find((each) => each === id);
      if (score !== undefined) pickScore(score);
    },
    [pickScore],
  );
  return (
    <TieBreakSheet
      title={t('scoring.chess.tiebreak.score.title')}
      body={body}
      hint={null}
      layout="chips"
      options={options}
      picked={sheet.draft.score ?? NO_SCORE}
      recordLabel={t('scoring.chess.how.record')}
      cancelLabel={cancelLabel}
      onPick={pick}
      onRecord={actions.recordTiebreak}
      onCancel={onCancel}
    />
  );
});

/**
 * How an Armageddon ended, from White's side: White is the player who did not have Black, so each result names that player
 * ("White won · L. Chen"), and a draw says Black advances.
 */
const ResultStep = memo(function ResultStep(props: StepProps) {
  const { sheet, halves, actions } = props;
  const { t, cancelLabel, onCancel } = useStep(props);
  const names = useNames(halves);
  const { black } = sheet.draft;
  const options = useMemo<readonly TieBreakChoice[]>(
    () =>
      black === null
        ? []
        : CHESS_ARMAGEDDON_RESULTS.map((result) => ({
            id: result,
            label: resultLabel(t, result, names, black),
          })),
    [black, names, t],
  );
  const { pickArmageddonResult } = actions;
  const pick = useCallback(
    (id: string | null) => {
      const result = CHESS_ARMAGEDDON_RESULTS.find((each) => each === id);
      if (result !== undefined) pickArmageddonResult(result);
    },
    [pickArmageddonResult],
  );
  return (
    <TieBreakSheet
      title={t('scoring.chess.tiebreak.result.title')}
      body={null}
      hint={null}
      layout="rows"
      options={options}
      picked={null}
      recordLabel={null}
      cancelLabel={cancelLabel}
      onPick={pick}
      onRecord={actions.recordTiebreak}
      onCancel={onCancel}
    />
  );
});

type Translate = ReturnType<typeof useT>['t'];

function resultLabel(
  t: Translate,
  result: (typeof CHESS_ARMAGEDDON_RESULTS)[number],
  names: Names,
  black: Seat,
): string {
  if (result === 'draw') return t('scoring.chess.tiebreak.result.draw');
  const holder = result === 'white' ? otherSeat(black) : black;
  return t(`scoring.chess.result.${result}`, { name: names[holder] });
}

/** The Armageddon's last step: who advances, and Record. */
const ConfirmStep = memo(function ConfirmStep(props: StepProps) {
  const { sheet, halves, actions } = props;
  const { t, cancelLabel, onCancel } = useStep(props);
  const body = useAdvances(sheet, halves);
  return (
    <TieBreakSheet
      title={t('scoring.chess.tiebreak.confirm.title')}
      body={body}
      hint={null}
      layout="rows"
      options={[]}
      picked={null}
      recordLabel={t('scoring.chess.how.record')}
      cancelLabel={cancelLabel}
      onPick={NO_PICK}
      onRecord={actions.recordTiebreak}
      onCancel={onCancel}
    />
  );
});
