import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { holdsScreen } from '@/domain/scoring/padView';
import type { TableTennisPadActions, TableTennisPadModel } from '@/hooks/useTableTennisMatch';
import type { TableTennisSheetView } from '@/hooks/useTableTennisSheets';
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
 * The table tennis pad (plan S2-2 Task 8; design §5; owner ruling 38: a screen per sport), drawn from the model of
 * `useTableTennisMatch`. Its layout is the set-based sports' (`PadContent`, lifted from badminton's screen): the top bar,
 * the strip (Game N of M, and Deuce), the two halves with the serving plate ("Serving · 1st"), the last-tap
 * line with the one Undo, and the tools (Set score and Expedite while offered, 13 returns or Who is serving?, and More:
 * owner rulings 54 and 55). What is table tennis's here: that the screen is held on while the pad is (`holdsScreen`), and
 * its sheets: More with the Card steps in its place, Start Expedite?, Who is serving?, Set score bounded by the rules'
 * limit, Match details, History and the reconnect question. There is no
 * ending prompt: table tennis declares no sanction ending. Sheets and History cover the pad, which is hidden from a
 * screen reader while they show.
 */
export function TableTennisPadScreen({ model }: { readonly model: TableTennisPadModel }) {
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
 * The sheet over the pad. The Card steps, More, Start Expedite? and Who is serving? are all a step sheet of choices, whose
 * id goes back as `choose`; the hook knows which sheet is open and what each id means.
 */
const PadSheet = memo(function PadSheet({
  sheet,
  actions,
}: {
  readonly sheet: TableTennisSheetView | null;
  readonly actions: TableTennisPadActions;
}) {
  if (sheet === null) return null;
  switch (sheet.kind) {
    case 'card':
    case 'more':
    case 'expedite':
    case 'serving':
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
