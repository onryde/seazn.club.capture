import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { SanctionSheet } from '@/domain/scoring/badmintonSanction';
import { holdsScreen } from '@/domain/scoring/padView';
import type { BadmintonPadActions, BadmintonPadModel } from '@/hooks/useBadmintonMatch';
import type { PadSheetView } from '@/hooks/usePadSheets';
import { AskSheet } from '@/ui/components/AskSheet';
import { EndingPrompt } from '@/ui/components/EndingPrompt';
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
 * The badminton pad (S2; owner rulings, 2026-10-31), drawn from its model, which is the real match's (`useBadmintonMatch`)
 * or the fake preview's (the pad's tests). Its layout is the set-based sports' (`PadContent`, lifted for table tennis's
 * twin, plan S2-2 Task 8): portrait, layout A. What is badminton's here: that the screen is held on while the pad is
 * (`holdsScreen`), and its sheets: Sanction, Set score, the ending prompt, Match details, History and the reconnect
 * question. Sheets and History cover the pad, which is hidden from a screen reader while they show.
 */
export function BadmintonPadScreen({ model }: { readonly model: BadmintonPadModel }) {
  const { view, sheet, actions } = model;
  return (
    <View style={styles.screen}>
      {holdsScreen(view.card) ? <KeepScreenOn /> : null}
      <PadContent model={model} covered={sheet !== null} />
      <PadSheet sheet={sheet} actions={actions} />
    </View>
  );
}

const PadSheet = memo(function PadSheet({
  sheet,
  actions,
}: {
  readonly sheet: PadSheetView | null;
  readonly actions: BadmintonPadActions;
}) {
  if (sheet === null) return null;
  switch (sheet.kind) {
    case 'sanction':
      return <SanctionSteps sheet={sheet.sheet} actions={actions} />;
    case 'setScore':
      return (
        <SetScoreSheet
          game={sheet.game}
          names={sheet.names}
          points={sheet.points}
          onSave={actions.saveScore}
          onCancel={actions.cancel}
        />
      );
    case 'ending':
      return (
        <EndingPrompt
          person={sheet.person}
          onRecord={actions.recordEnding}
          onVoid={actions.voidSanction}
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

const SanctionSteps = memo(function SanctionSteps({
  sheet,
  actions,
}: {
  readonly sheet: SanctionSheet;
  readonly actions: BadmintonPadActions;
}) {
  return <StepSheetView sheet={sheet} onChoose={actions.choose} onCancel={actions.cancel} />;
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.ground },
});
