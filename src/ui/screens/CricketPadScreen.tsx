import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { hasUndoCell, holdsScreen } from '@/domain/scoring/padView';
import type { CricketPadActions, CricketPadModel } from '@/hooks/useCricketMatch';
import type { CricketSheetView } from '@/hooks/useCricketSheets';
import { AskSheet } from '@/ui/components/AskSheet';
import { KeepScreenOn } from '@/ui/components/KeepScreenOn';
import { PadContent } from '@/ui/components/PadContent';
import { DiscardAsk, MatchDetailsView, MatchHistory } from '@/ui/components/PadSheets';
import { CricketBoard } from '@/ui/screens/CricketBoard';
import { CricketKeys } from '@/ui/screens/CricketKeys';
import { CricketSetup } from '@/ui/screens/CricketSetup';
import { CricketStepSheet } from '@/ui/screens/CricketSheets';
import { colour, space } from '@/ui/theme/tokens';

/**
 * The cricket pad (S2-4 spec §5; plan Task 8; owner ruling 38: a screen per sport), drawn from the model of
 * `useCricketMatch`, portrait. Its frame is the kit's (`PadContent`): the top bar (Home, the sync status, Match details and
 * History), the strip (the result once one stands), the last-tap line (the status line: the last ball, or a refusal in
 * caution). In the halves' place stands cricket's board (`CricketBoard`): the score, the crease and the bowler, this
 * over with a free hit when one is due; under it, while an innings is being scored, the keys (`CricketKeys`: the runs,
 * the extras, and Out, Undo and More, which carries the pad's one Undo, so the line has none). Before the first ball the
 * setup stands there instead (`CricketSetup`: the toss on the whole screen, the batting order, the first bowler, Start),
 * and the line keeps Undo, which takes the toss back. The screen is held on while the pad is (`holdsScreen`). Sheets and
 * History cover the pad, which is hidden from a screen reader while they show, and every key is disabled under them.
 */
export function CricketPadScreen({ model }: { readonly model: CricketPadModel }) {
  const { view, sheet, setup } = model;
  const keys = setup === null && model.display.stage === 'live';
  return (
    <View style={styles.screen}>
      {holdsScreen(view.card) ? <KeepScreenOn /> : null}
      <PadContent
        model={model}
        covered={sheet !== null}
        body={<CricketBody model={model} keys={keys} />}
        lineUndo={!keys}
      />
      <PadSheet sheet={sheet} actions={model.actions} />
    </View>
  );
}

/** The board and its keys, or the setup before the first ball. */
function CricketBody({ model, keys }: { readonly model: CricketPadModel; readonly keys: boolean }) {
  const { view, sheet, actions, board, setup } = model;
  if (setup !== null)
    return <CricketSetup setup={setup} details={view.details} actions={actions} />;
  return (
    <View style={styles.body}>
      <CricketBoard view={board} />
      {keys ? (
        <CricketKeys
          undo={view.lastTap?.undo === true}
          undoCell={hasUndoCell(view.card)}
          onMore={null}
          disabled={sheet !== null}
          actions={actions}
        />
      ) : null}
    </View>
  );
}

/** The sheet over the pad: Match details, History, a step, or the reconnect question and its confirm. */
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
    case 'step':
      return (
        <CricketStepSheet step={sheet.step} onChoose={actions.choose} onCancel={actions.dismiss} />
      );
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
  body: { flex: 1, gap: space.sm },
});
