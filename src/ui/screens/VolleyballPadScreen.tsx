import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { holdsScreen } from '@/domain/scoring/padView';
import type { VolleyballPadActions, VolleyballPadModel } from '@/hooks/useVolleyballMatch';
import type { VolleyballSheetView } from '@/hooks/useVolleyballSheets';
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
 * The volleyball pad (S2-6 Task 11; spec §5, layout A, owner ruling 178: a screen per sport), drawn from the model of
 * `useVolleyballMatch`. Its layout is the set-based sports' (`PadContent`): the top bar, the strip (Set N of M, the set's
 * target and the deuce or golden-point note), the two halves with the serving plate, the side's card and the counts at its
 * foot ("T/O 1 of 2 · Subs 4 of 6", `ScoreHalf`'s `foot`), the last-tap line with the one Undo, and the tools (Set score
 * before a set's first rally, Timeout, Sub indoors, More). What is volleyball's here: that the screen is held on while the
 * pad is (`holdsScreen`), and its sheets: a side to choose for Timeout and Sub, the sub's and the sanction's steps, Who
 * serves first?, Set score, Match details, History and the reconnect question. Sheets and History cover the pad, which is
 * hidden from a screen reader while they show.
 */
export function VolleyballPadScreen({ model }: { readonly model: VolleyballPadModel }) {
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
 * The sheet over the pad. The side choices, Sub's and Sanction's steps, More and Who serves first? are all a step sheet
 * of choices, whose id goes back as `choose`; the hook knows which sheet is open and what each id means.
 */
const PadSheet = memo(function PadSheet({
  sheet,
  actions,
}: {
  readonly sheet: VolleyballSheetView | null;
  readonly actions: VolleyballPadActions;
}) {
  if (sheet === null) return null;
  switch (sheet.kind) {
    case 'side':
    case 'sub':
    case 'more':
    case 'sanction':
    case 'serving':
    case 'toss':
      return (
        <StepSheetView sheet={sheet.sheet} onChoose={actions.choose} onCancel={actions.cancel} />
      );
    case 'setScore':
      return (
        <SetScoreSheet
          game={sheet.game}
          names={sheet.names}
          points={sheet.points}
          bound={sheet.bound}
          onSave={actions.saveScore}
          onCancel={actions.cancel}
        />
      );
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.ground },
});
