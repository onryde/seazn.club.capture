import { memo, useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  binOver,
  footballBoard,
  footballClockBar,
  footballCorrectTime,
  footballLeads,
  footballTakesCorrect,
  type BoardAction,
  type BoardBin,
  type BoardColumn,
} from '@/domain/scoring/footballBoard';
import type { FootballDisplay, FootballPadKey } from '@/domain/scoring/footballTypes';
import { holdsScreen, type PadHalf, type PadStateCard } from '@/domain/scoring/padView';
import { useClockTick } from '@/hooks/useClockTick';
import type { FootballPadActions, FootballPadModel } from '@/hooks/useFootballMatch';
import type { FootballSheetView } from '@/hooks/useFootballSheets';
import { useT } from '@/hooks/useLanguage';
import { usePadText } from '@/hooks/usePadText';
import { AskSheet } from '@/ui/components/AskSheet';
import { ClockBar } from '@/ui/components/ClockBar';
import { ClockCorrectSheet, type ClockCorrectWords } from '@/ui/components/ClockCorrectSheet';
import { KeepScreenOn } from '@/ui/components/KeepScreenOn';
import { KickRow } from '@/ui/components/KickRow';
import { PadContent } from '@/ui/components/PadContent';
import {
  DiscardAsk,
  MatchDetailsView,
  MatchHistory,
  StepSheetView,
} from '@/ui/components/PadSheets';
import { TeamColumn, type TeamAction, type TeamColumnView } from '@/ui/components/TeamColumn';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

/**
 * The football pad (S2-5 design §6; plan P Task 12; owner ruling 38: a screen per sport), drawn from the model of
 * `useFootballMatch`. Its frame is every pad's (`PadContent`): the top bar, the strip, the last-tap line with the one Undo
 * and the tools (End of period and More). In the halves' place it draws football's own body: the clock bar, then the two
 * team columns, home on the left, each with its name, score, marks and buttons, and in the shootout each team's kicks.
 * Only the clock's leaf ticks (and a sin-bin's mark while its bin runs): nothing else re-renders each second (AGENTS §8).
 * Sheets cover the pad, which is hidden from a screen reader while they show.
 */
export function FootballPadScreen({ model }: { readonly model: FootballPadModel }) {
  const { view, sheet, actions, display, readingNow } = model;
  const body = useMemo(
    () => (
      <FootballBoardView
        display={display}
        card={view.card}
        halves={view.halves}
        readingNow={readingNow}
        actions={actions}
      />
    ),
    [display, view.card, view.halves, readingNow, actions],
  );
  return (
    <View style={styles.screen}>
      {holdsScreen(view.card) ? <KeepScreenOn /> : null}
      <PadContent model={model} covered={sheet !== null} body={body} />
      <PadSheet sheet={sheet} display={display} readingNow={readingNow} actions={actions} />
    </View>
  );
}

type BoardProps = {
  readonly display: FootballDisplay;
  readonly card: PadStateCard | null;
  readonly halves: readonly [PadHalf<FootballPadKey>, PadHalf<FootballPadKey>];
  readonly readingNow: () => number;
  readonly actions: FootballPadActions;
};

/** The clock bar over the two columns (design §6.1, §6.2), and in the shootout each team's kicks under its column (§6.5). */
const FootballBoardView = memo(function FootballBoardView({
  display,
  card,
  halves,
  readingNow,
  actions,
}: BoardProps) {
  const board = useMemo(() => footballBoard(display, card), [display, card]);
  return (
    <View testID="football-board" style={styles.board}>
      <FootballClockLeaf display={display} readingNow={readingNow} actions={actions} />
      <View style={styles.columns}>
        {board.columns.map((column, at) => (
          <SideColumn
            key={column.side}
            column={column}
            half={halves[at]!}
            kicks={board.kicks?.[at] ?? null}
            display={display}
            readingNow={readingNow}
            onAction={actions.column}
          />
        ))}
      </View>
    </View>
  );
});

/**
 * The one part that ticks (AGENTS §8): the shared clock's reading once a second while it runs, as the clock bar draws it.
 * A tap on the time opens Correct while the match takes one (`footballTakesCorrect`).
 */
const FootballClockLeaf = memo(function FootballClockLeaf({
  display,
  readingNow,
  actions,
}: {
  readonly display: FootballDisplay;
  readonly readingNow: () => number;
  readonly actions: FootballPadActions;
}) {
  useClockTick(display.clock.anchor?.running === true);
  const view = footballClockBar(display, readingNow());
  const onCorrect = footballTakesCorrect(display) ? actions.correct : null;
  return <ClockBar view={view} onAction={actions.clock} onCorrect={onCorrect} />;
});

/** A team's column in the operator's words, and in the shootout its kicks under it. */
const SideColumn = memo(function SideColumn({
  column,
  half,
  kicks,
  display,
  readingNow,
  onAction,
}: {
  readonly column: BoardColumn;
  readonly half: PadHalf<FootballPadKey>;
  readonly kicks: readonly boolean[] | null;
  readonly display: FootballDisplay;
  readonly readingNow: () => number;
  readonly onAction: (id: string) => void;
}) {
  const words = usePadText();
  const view = useMemo<TeamColumnView>(
    () => ({
      label: half.label,
      bar: half.bar,
      value: half.value,
      lead: footballLeads(display, column.side),
      cards: display.sides[column.side].cards,
      said: half.marks?.said.map(words) ?? [],
      tags: column.bins.map((bin, at) => (
        <SinBinTag key={at} bin={bin} display={display} readingNow={readingNow} />
      )),
      actions: column.actions.map((action) => teamAction(action, words)),
    }),
    [half, column, display, readingNow, words],
  );
  return (
    <View testID={`column-${column.side}`} style={styles.side}>
      <TeamColumn view={view} onAction={onAction} />
      {kicks === null ? null : <KickRow kicks={kicks} />}
    </View>
  );
});

const teamAction = (
  action: BoardAction,
  words: (text: BoardAction['label']) => string,
): TeamAction => ({
  id: action.id,
  label: words(action.label),
  primary: action.primary,
  enabled: action.enabled,
  note: action.note === null ? null : words(action.note),
});

/**
 * A player in the sin-bin: the shirt number, and "Sin-bin over" once the clock passes the bin's end (design §6.4). It
 * ticks only while its bin runs on a running clock; the pad sends nothing when it is over (the scorer taps Back).
 */
const SinBinTag = memo(function SinBinTag({
  bin,
  display,
  readingNow,
}: {
  readonly bin: BoardBin;
  readonly display: FootballDisplay;
  readonly readingNow: () => number;
}): ReactNode {
  const { t } = useT();
  const running = display.clock.anchor?.running === true && bin.over !== null;
  useClockTick(running);
  const over = binOver(bin.over, { period: display.enginePhase, elapsed: readingNow() });
  return (
    <Text testID="sin-bin" variant="periodScore" style={over ? styles.binOver : styles.bin}>
      {over ? `${bin.label} · ${t('scoring.football.mark.sinBinOver')}` : bin.label}
    </Text>
  );
});

/** The sheet over the pad; the hook knows which is open and what each of its buttons means. */
const PadSheet = memo(function PadSheet({
  sheet,
  display,
  readingNow,
  actions,
}: {
  readonly sheet: FootballSheetView | null;
  readonly display: FootballDisplay;
  readonly readingNow: () => number;
  readonly actions: FootballPadActions;
}) {
  if (sheet === null) return null;
  switch (sheet.kind) {
    case 'step':
      return (
        <StepSheetView
          sheet={sheet.sheet}
          onChoose={actions.choose}
          onCancel={actions.cancelSheet}
        />
      );
    case 'correct':
      return (
        <CorrectView sheet={sheet} display={display} readingNow={readingNow} actions={actions} />
      );
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
 * Correct (design §7.5): the time it will be set to, which runs on with the clock while the sheet is open (its own tick,
 * as the clock leaf), the four steppers, and Set.
 */
const CorrectView = memo(function CorrectView({
  sheet,
  display,
  readingNow,
  actions,
}: {
  readonly sheet: Extract<FootballSheetView, { kind: 'correct' }>;
  readonly display: FootballDisplay;
  readonly readingNow: () => number;
  readonly actions: FootballPadActions;
}) {
  const { t } = useT();
  useClockTick(display.clock.anchor?.running === true);
  const time = footballCorrectTime(display, readingNow() + sheet.deltaSeconds);
  const words = useMemo<ClockCorrectWords>(
    () => ({
      title: t('scoring.football.correct.title'),
      set: t('scoring.football.correct.set'),
      steps: {
        [-60]: t('scoring.football.correct.back60'),
        [-10]: t('scoring.football.correct.back10'),
        10: t('scoring.football.correct.fwd10'),
        60: t('scoring.football.correct.fwd60'),
      },
    }),
    [t],
  );
  return (
    <ClockCorrectSheet
      time={time}
      atFloor={sheet.atFloor}
      floorLine={t('scoring.football.correct.floor')}
      words={words}
      onStep={actions.step}
      onSet={actions.set}
      onCancel={actions.cancelSheet}
    />
  );
});

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colour.ground },
  board: { flex: 1, gap: space.sm },
  columns: { flex: 1, flexDirection: 'row', gap: space.sm },
  side: { flex: 1, gap: space.xs },
  bin: { color: colour.ink2 },
  binOver: { color: colour.ink },
});
