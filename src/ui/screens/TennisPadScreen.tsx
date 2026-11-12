import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { holdsScreen } from '@/domain/scoring/padView';
import type { TennisPadActions, TennisPadModel } from '@/hooks/useTennisMatch';
import type { TennisSheetView } from '@/hooks/useTennisSheets';
import { useT } from '@/hooks/useLanguage';
import { AskSheet } from '@/ui/components/AskSheet';
import { KeepScreenOn } from '@/ui/components/KeepScreenOn';
import { PadContent } from '@/ui/components/PadContent';
import {
  DiscardAsk,
  MatchDetailsView,
  MatchHistory,
  SetScoreSheet,
  StepSheetView,
} from '@/ui/components/PadSheets';
import { colour } from '@/ui/theme/tokens';

/**
 * The tennis pad (S2-7 Task 11; spec layout A, owner ruling 38: a screen per sport), drawn from the model of
 * `useTennisMatch`. Its layout is the set-based sports' (`PadContent`): the top bar, the strip (Set N of M, the note and
 * Change ends), the two halves with the serve ball and the side's card, the last-tap line with the one Undo, and the four
 * tools that always fill the row (Violation, Break, Award game, Set score: rulings 228, 231, 232). What is tennis's here: that
 * the screen is held on while the pad is (`holdsScreen`) and its sheets. The Start screen is the kit's, with the serve question
 * (ruling 233): the hook's Start turns the pick into the toss and the start.
 */
export function TennisPadScreen({ model }: { readonly model: TennisPadModel }) {
  const { view, sheet, actions } = model;
  return (
    <View style={styles.screen}>
      {holdsScreen(view.card) ? <KeepScreenOn /> : null}
      <PadContent model={model} covered={sheet !== null} />
      <PadSheet sheet={sheet} actions={actions} />
    </View>
  );
}

/**
 * The sheet over the pad. Violation's, Award game's and Break's steps are all a step sheet of choices, whose id goes back
 * as `choose`; the hook knows which sheet is open and what each id means.
 */
const PadSheet = memo(function PadSheet({
  sheet,
  actions,
}: {
  readonly sheet: TennisSheetView | null;
  readonly actions: TennisPadActions;
}) {
  if (sheet === null) return null;
  switch (sheet.kind) {
    case 'side':
    case 'violation':
    case 'award':
    case 'break':
      return (
        <StepSheetView sheet={sheet.sheet} onChoose={actions.choose} onCancel={actions.cancel} />
      );
    case 'setScore':
      return <TennisSetScore sheet={sheet} actions={actions} />;
    case 'details':
      return <MatchDetailsView details={sheet.details} onClose={actions.dismiss} />;
    case 'history':
      return <MatchHistory groups={sheet.groups} onClose={actions.cancel} />;
    case 'ask':
      return <AskSheet ask={sheet.ask} onSend={actions.sendTaps} onDiscard={actions.askDiscard} />;
    case 'discard':
      return (
        <DiscardAsk
          queued={sheet.ask.queued}
          onKeep={actions.dismiss}
          onDiscard={actions.confirmDiscard}
        />
      );
  }
});

const SET_SCORE_STARTS: readonly [number, number] = [0, 0];

/**
 * Set score: its games, then a tie-break set's points, in one sheet (S2-7 plan G4). The stage is the sheet's key, so the
 * fields start again at 0 for the second stage and not at the games just typed.
 */
const TennisSetScore = memo(function TennisSetScore({
  sheet,
  actions,
}: {
  readonly sheet: Extract<TennisSheetView, { readonly kind: 'setScore' }>;
  readonly actions: TennisPadActions;
}) {
  const { t } = useT();
  return (
    <SetScoreSheet
      key={sheet.stage}
      game={sheet.set}
      names={sheet.names}
      points={SET_SCORE_STARTS}
      bound={sheet.bound}
      title={t('scoring.tennis.setScore.title', { set: sheet.set })}
      fieldKey={
        sheet.stage === 'games'
          ? 'scoring.tennis.setScore.games'
          : 'scoring.tennis.setScore.tiebreak'
      }
      onSave={actions.saveScore}
      onCancel={actions.cancel}
    />
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.ground },
});
