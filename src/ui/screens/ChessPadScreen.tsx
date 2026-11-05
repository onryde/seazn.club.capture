import { memo, useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ChessPadKey } from '@/domain/scoring/chessTypes';
import { holdsScreen, type PadView } from '@/domain/scoring/padView';
import type { ChessPadActions, ChessPadModel } from '@/hooks/useChessMatch';
import type { ChessSheetView } from '@/hooks/useChessSheets';
import { useT } from '@/hooks/useLanguage';
import { AskSheet } from '@/ui/components/AskSheet';
import { HowSheet } from '@/ui/components/HowSheet';
import { KeepScreenOn } from '@/ui/components/KeepScreenOn';
import { PadContent } from '@/ui/components/PadContent';
import { DiscardAsk, MatchDetailsView, MatchHistory } from '@/ui/components/PadSheets';
import { colour } from '@/ui/theme/tokens';

/**
 * The chess pad (plan S2-3 Task 3; design §4 to §6; owner ruling 38: a screen per sport), drawn from the model of
 * `useChessMatch`. Its layout is the set-based sports' (`PadContent`): the top bar, the strip (the organiser's lines),
 * the two players as the halves, each with its colour's plate and what a tap records, the last-tap line with the one
 * Undo, and the tools (Draw and Swap colours). What is chess's here: that the screen is held on while the pad is
 * (`holdsScreen`), and its sheets: the one that asks How a game ended, Match details, History and the reconnect
 * question. Sheets and History cover the pad, which is hidden from a screen reader while they show.
 */
export function ChessPadScreen({ model }: { readonly model: ChessPadModel }) {
  const { view, sheet, actions } = model;
  return (
    <View style={styles.screen}>
      {holdsScreen(view.card) ? <KeepScreenOn /> : null}
      <PadContent model={model} covered={sheet !== null} />
      <PadSheet sheet={sheet} view={view} actions={actions} />
    </View>
  );
}

/** The sheet over the pad; the hook knows which is open and what each button of it means. */
const PadSheet = memo(function PadSheet({
  sheet,
  view,
  actions,
}: {
  readonly sheet: ChessSheetView | null;
  readonly view: PadView<ChessPadKey>;
  readonly actions: ChessPadActions;
}) {
  if (sheet === null) return null;
  switch (sheet.kind) {
    case 'how':
      return <HowView sheet={sheet} view={view} actions={actions} />;
    case 'details':
      return <MatchDetailsView details={sheet.details} onClose={actions.dismiss} />;
    case 'history':
      return <MatchHistory groups={sheet.groups} onClose={actions.dismiss} />;
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

/**
 * How did the player win, or how was it drawn: the title names the player in the seat the scorer chose, as the half
 * names them, and the methods are the list the hook offers for that result, in the engine's order, in the operator's
 * language. A tap on the picked method gives none back (the sheet says so); Record, Cancel and the dim are the hook's.
 */
const HowView = memo(function HowView({
  sheet,
  view,
  actions,
}: {
  readonly sheet: Extract<ChessSheetView, { kind: 'how' }>;
  readonly view: PadView<ChessPadKey>;
  readonly actions: ChessPadActions;
}) {
  const { t } = useT();
  const { winner, methods } = sheet;
  const name = view.halves.find((half) => half.side === winner)?.label ?? '';
  const title =
    winner === null ? t('scoring.chess.how.drawn') : t('scoring.chess.how.won', { name });
  const options = useMemo(
    () => methods.map((method) => ({ id: method, label: t(`scoring.chess.method.${method}`) })),
    [methods, t],
  );
  const { pickMethod } = actions;
  const pick = useCallback(
    (id: string | null) => pickMethod(methods.find((method) => method === id) ?? null),
    [pickMethod, methods],
  );
  return (
    <HowSheet
      title={title}
      options={options}
      picked={sheet.picked}
      recordLabel={t('scoring.chess.how.record')}
      cancelLabel={t('scoring.sheet.cancel')}
      onPick={pick}
      onRecord={actions.record}
      onCancel={actions.cancelSheet}
    />
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.ground },
});
