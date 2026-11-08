import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { holdsScreen } from '@/domain/scoring/padView';
import type { CricketPadActions, CricketPadModel } from '@/hooks/useCricketMatch';
import type { CricketSheetView } from '@/hooks/useCricketSheets';
import { AskSheet } from '@/ui/components/AskSheet';
import { KeepScreenOn } from '@/ui/components/KeepScreenOn';
import { PadContent } from '@/ui/components/PadContent';
import { DiscardAsk, MatchDetailsView, MatchHistory } from '@/ui/components/PadSheets';
import { CricketBoard } from '@/ui/screens/CricketBoard';
import { CricketSetup } from '@/ui/screens/CricketSetup';
import { colour } from '@/ui/theme/tokens';

/**
 * The cricket pad (S2-4 spec §5; plan Task 8; owner ruling 38: a screen per sport), drawn from the model of
 * `useCricketMatch`, portrait. Its frame is the kit's (`PadContent`): the top bar (Home, the sync status, Match details and
 * History), the strip (the result once one stands), the last-tap line with the one Undo. In the halves' place stands
 * cricket's board (`CricketBoard`): the score, the crease and the bowler, this over; before the first ball, the setup
 * (`CricketSetup`: the toss on the whole screen, the batting order, the first bowler, Start). The run keys,
 * the extras and Out, Undo, More are Task 11's. The screen is held on while the pad is (`holdsScreen`). Sheets and History
 * cover the pad, which is hidden from a screen reader while they show.
 */
export function CricketPadScreen({ model }: { readonly model: CricketPadModel }) {
  const { view, sheet, actions, board, setup } = model;
  const body =
    setup === null ? (
      <CricketBoard view={board} />
    ) : (
      <CricketSetup setup={setup} details={view.details} actions={actions} />
    );
  return (
    <View style={styles.screen}>
      {holdsScreen(view.card) ? <KeepScreenOn /> : null}
      <PadContent model={model} covered={sheet !== null} body={body} />
      <PadSheet sheet={sheet} actions={actions} />
    </View>
  );
}

/** The sheet over the pad: Match details, History, or the reconnect question and its confirm. */
const PadSheet = memo(function PadSheet({
  sheet,
  actions,
}: {
  readonly sheet: CricketSheetView | null;
  readonly actions: CricketPadActions;
}) {
  if (sheet === null) return null;
  switch (sheet.kind) {
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
