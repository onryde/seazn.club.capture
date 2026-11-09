import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { hasUndoCell, holdsScreen } from '@/domain/scoring/padView';
import type { CricketPadActions, CricketPadModel } from '@/hooks/useCricketMatch';
import type { CricketSheetView } from '@/hooks/useCricketSheets';
import { AskSheet } from '@/ui/components/AskSheet';
import { KeepScreenOn } from '@/ui/components/KeepScreenOn';
import { PadContent } from '@/ui/components/PadContent';
import { DiscardAsk, MatchDetailsView, MatchHistory } from '@/ui/components/PadSheets';
import { CricketBoard, ScorePanel } from '@/ui/screens/CricketBoard';
import { CricketKeys } from '@/ui/screens/CricketKeys';
import { CricketEntrySheet } from '@/ui/screens/CricketEntrySheet';
import { CricketPlayersSheet } from '@/ui/screens/CricketPlayersSheet';
import { CricketScorecard } from '@/ui/screens/CricketScorecard';
import { CricketSetup } from '@/ui/screens/CricketSetup';
import { CricketStandingSheet, CricketStepSheet } from '@/ui/screens/CricketSheets';
import { CricketTotalsPanel, CricketTotalsSheet } from '@/ui/screens/CricketTotals';
import { colour, space } from '@/ui/theme/tokens';

/**
 * The cricket pad (S2-4 spec §5; plan Task 8; owner ruling 38: a screen per sport), drawn from the model of
 * `useCricketMatch`, portrait. Its frame is the kit's (`PadContent`): the top bar (Home, the sync status, Match details and
 * History), the strip (the result once one stands), the last-tap line (the status line: the last ball, or a refusal in
 * caution). In the halves' place stands cricket's board (`CricketBoard`): the score, the crease and the bowler, this
 * over with a free hit when one is due, which opens Players on a tap (Task 14); under it, while an innings is being scored, the keys (`CricketKeys`: the runs,
 * the extras, and Out, Undo and More, which carries the pad's one Undo, so the line has none). Before the first ball the
 * setup stands there instead (`CricketSetup`: the toss on the whole screen, the batting order, the first bowler, Start),
 * and the line keeps Undo, which takes the toss back. At an innings break and before a super over the same setup stands
 * under the break's card until Start innings (Task 16), and the line's Undo takes back the innings' last ball. A side with
 * no players entered stands in totals (Task 17): the score and, in the keys' place, the over to enter
 * (`CricketTotalsPanel`), and the same entry in a sheet where the over-end sheet has nobody to bowl
 * (`CricketTotalsSheet`). The screen is held on while the pad is (`holdsScreen`). Sheets and
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
      <PadSheet
        sheet={sheet}
        undo={view.lastTap?.undo === true}
        more={model.more}
        actions={model.actions}
      />
    </View>
  );
}

/** The board and its keys, or the setup before the first ball. */
function CricketBody({ model, keys }: { readonly model: CricketPadModel; readonly keys: boolean }) {
  const { view, sheet, actions, board, setup } = model;
  if (setup !== null)
    return (
      <CricketSetup setup={setup} details={view.details} more={model.more} actions={actions} />
    );
  if (model.totals !== null) return <TotalsBody model={model} />;
  return (
    <View style={styles.body}>
      <CricketBoard view={board} onOpenPlayers={actions.openPlayers} />
      {keys ? (
        <CricketKeys
          undo={view.lastTap?.undo === true}
          undoCell={hasUndoCell(view.card)}
          onMore={model.more ? actions.openMore : null}
          disabled={sheet !== null}
          actions={actions}
        />
      ) : null}
    </View>
  );
}

/** Over totals (Task 17): the score, and under it the over to enter or the organiser's line for a tie. */
function TotalsBody({ model }: { readonly model: CricketPadModel }) {
  const { totals, board, actions } = model;
  if (totals === null) return null;
  return (
    <View style={styles.body}>
      <ScorePanel score={board.score} />
      <CricketTotalsPanel totals={totals} onRecord={actions.enterTotals} />
    </View>
  );
}

/**
 * The sheet over the pad: Match details, History, a step, Players, More's typed numbers, or the reconnect question and its
 * confirm. The over-end sheet stands by itself (`CricketStandingSheet`): its dim takes no tap, its way back is Undo of this
 * phone's last tap when there is one (guarded: the thumb that lifted off the over's last key lands there), and it carries
 * Players and More.
 */
const PadSheet = memo(function PadSheet({
  sheet,
  undo,
  more,
  actions,
}: {
  readonly sheet: CricketSheetView | null;
  readonly undo: boolean;
  readonly more: boolean;
  readonly actions: CricketPadActions;
}) {
  if (sheet === null) return null;
  switch (sheet.kind) {
    case 'details':
      return (
        <MatchDetailsView
          details={sheet.details}
          onClose={actions.dismiss}
          sport={
            sheet.scorecard.length === 0 ? null : <CricketScorecard innings={sheet.scorecard} />
          }
        />
      );
    case 'history':
      return <MatchHistory groups={sheet.groups} onClose={actions.cancel} />;
    case 'ask':
      return <AskSheet ask={sheet.ask} onSend={actions.sendTaps} onDiscard={actions.askDiscard} />;
    case 'step':
      return sheet.standing ? (
        <CricketStandingSheet
          step={sheet.step}
          undo={undo}
          more={more}
          onChoose={actions.choose}
          onUndo={actions.undoStanding}
          onPlayers={actions.openPlayers}
          onMore={actions.openMore}
        />
      ) : (
        <CricketStepSheet
          step={sheet.step}
          onChoose={actions.choose}
          onDim={actions.dismiss}
          onCancel={actions.dismiss}
        />
      );
    case 'players':
      return (
        <CricketPlayersSheet
          tab={sheet.tab}
          players={sheet.players}
          onTab={actions.playersTab}
          onMove={actions.moveYet}
          onBowler={actions.pickBowler}
          onClose={actions.dismiss}
        />
      );
    case 'entry':
      return (
        <CricketEntrySheet
          step={sheet.step}
          accepts={sheet.accepts}
          onRecord={actions.enter}
          onCancel={actions.dismiss}
        />
      );
    case 'totals':
      return (
        <CricketTotalsSheet
          totals={sheet.totals}
          onRecord={actions.enterTotals}
          onCancel={actions.dismiss}
        />
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
