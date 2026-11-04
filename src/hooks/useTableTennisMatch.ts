import { useCallback, useMemo, useState } from 'react';
import { TAKEN, refusing, refusalLine } from '@/domain/scoring/padLine';
import type { PadSide } from '@/domain/scoring/padView';
import type { MatchPad } from '@/domain/scoring/scoringMatchView';
import type { HalfFlash } from '@/domain/scoring/tapFlash';
import {
  parseTableTennisTool,
  withHeldServing,
  type TableTennisPadKey,
  type TableTennisTypes,
} from '@/domain/scoring/tableTennisPad';
import { tableTennisSport } from '@/domain/scoring/tableTennisSport';
import type { PadActions, PadScreenModel, ScoringMatch } from '@/hooks/padScreenModel';
import type { ScoringRunner } from '@/hooks/scoringRunner';
import { useBackCloses } from '@/hooks/useBackCloses';
import { useHeldServing } from '@/hooks/useHeldServing';
import { useAskActions, useClosedByDeadLink, useStartActions } from '@/hooks/usePadMatchParts';
import { useGuardedTool, useSettle, useTaps, type PadTapDriver } from '@/hooks/usePadTaps';
import type { Ports } from '@/hooks/usePorts';
import { useLinks, useScoringMatch, useSender, type MatchSender } from '@/hooks/useScoringMatch';
import { useBackToHome } from '@/hooks/useStreamLinks';
import {
  useTableTennisSheets,
  type TableTennisSheetDriver,
  type TableTennisSheetSnapshot,
  type TableTennisSheetView,
} from '@/hooks/useTableTennisSheets';
import type { MessageKey } from '@/i18n/messages';

/**
 * A table tennis match on the pad screen (plan S2-2 Task 7): the generic match (`useScoringMatch`) with table tennis's pad
 * hook, as `useBadmintonMatch` is badminton's. What is table tennis's here: a half is a rally that may carry the held
 * answer to Who is serving? (`useHeldServing`), 13 returns is a point of its own on a cell that stays on screen, the
 * sheets are More (with the Card steps in its place), Start Expedite?, Who is serving? and Set score
 * (`useTableTennisSheets`), and there is no ending prompt: table tennis declares no sanction ending.
 */

/**
 * Table tennis's own buttons, beside every pad's (`PadActions`): the sheets' choices (a Card's steps, a More item, a side
 * for the serve), Set score's save, the Start screen, and the reconnect question's answers.
 */
export type TableTennisPadActions = PadActions & {
  /**
   * A choice on the sheet open: a Card's level or player, a More item, or the side serving. The answer to Who is serving?
   * (ruling 51) is given only here, on its sheet: held for the next point, which carries it.
   */
  readonly choose: (id: string) => void;
  readonly saveScore: (first: string, second: string) => void;
  /** The Start screen (ruling 49): who serves first, picked; then Start match, a tap. */
  readonly pickServer: (side: PadSide) => void;
  readonly start: () => void;
  /** The reconnect question (owner ruling 43): Send my taps, Discard them (which asks again) and its confirm's Discard. */
  readonly sendTaps: () => void;
  readonly askDiscard: () => void;
  readonly confirmDiscard: () => void;
};

/** What the table tennis pad screen is drawn from. */
export type TableTennisPadModel = PadScreenModel<TableTennisPadKey, TableTennisSheetView> & {
  /** The Start screen's pick of who serves first; none until the scorer picks, and none once the match starts. */
  readonly toss: PadSide | null;
  readonly actions: TableTennisPadActions;
};

export function useTableTennisMatch(fixtureId: string): ScoringMatch<TableTennisPadModel> {
  return useScoringMatch(fixtureId, tableTennisSport, useTableTennisPad);
}

type PadFacts = MatchPad<TableTennisTypes>;
type Sender = MatchSender<TableTennisTypes>;
type Held = ReturnType<typeof useHeldServing>;

function useTableTennisPad(
  ports: Ports,
  runner: ScoringRunner | null,
  pad: PadFacts | null,
): TableTennisPadModel | null {
  const sender = useSender<TableTennisTypes>(ports, runner);
  const [flash, setFlash] = useState<HalfFlash>(null);
  const [cardNote, setCardNote] = useState<MessageKey | null>(null);
  const held = useHeldServing(pad?.display.anchorNeeded ?? false, pad?.display.scoreEvents ?? 0);
  const settle = useSettle(sender.say);
  const { carry, clear } = held;
  const driver = useMemo<PadTapDriver>(
    () => ({
      rally: (side) =>
        carry((serving, servingAt) => sender.tap({ kind: 'rally', side, serving, servingAt })),
      // Undo takes this phone's last tap back: the answer made after it is made to a score that no longer stands.
      undo: () => {
        const outcome = sender.undo();
        if (outcome.ok) clear();
        return outcome;
      },
    }),
    [sender, carry, clear],
  );
  const taps = useTaps(driver, settle, sender.say, setFlash);
  const sheets = useSheets(sender, held, taps.opening, pad);
  const actions = useActions({ sender, runner, pad, taps, sheets, setCardNote });
  useBackCloses(sheets.open, sheets.cancel);
  const view = useMemo(
    () => (pad === null ? null : withHeldServing(pad.view, held.side, pad.display)),
    [pad, held.side],
  );
  return useMemo(
    () =>
      pad === null || view === null
        ? null
        : {
            kind: 'pad',
            view,
            sheet: sheets.view,
            line: pad.line,
            cardNote,
            flash,
            toss: pad.toss,
            actions,
          },
    [pad, view, sheets.view, cardNote, flash, actions],
  );
}

/**
 * The sheets over the pad: what each button asks of the match, as taps (a card, a timeout, Expedite, a game's score) or,
 * for Who is serving?, as the answer held for the next point. Closed at once when the link dies, since the bad-link card
 * then shows (round 8 hardening).
 */
function useSheets(
  sender: Sender,
  held: Held,
  opening: ReturnType<typeof useTaps>['opening'],
  pad: PadFacts | null,
) {
  const { tap, say } = sender;
  const { put } = held;
  const driver = useMemo<TableTennisSheetDriver>(
    () => ({
      card: (card) => tap({ kind: 'sanction', ...card }),
      timeout: (side) => tap({ kind: 'timeout', side }),
      expedite: () => tap({ kind: 'expedite' }),
      // A game's score set moves the count of score events, which ends an answer made before it (`useHeldServing` ties the
      // answer to the count); a Set score the match refuses moves nothing and leaves it.
      setScore: (first, second) => tap({ kind: 'setScore', first, second }),
      // `put` takes no answer once the pad needs none; but then the sheet is already stale and closes before a choice can
      // reach here (`useTableTennisSheets`: a serving step is stale when `anchorNeeded` is false), so no test reaches the
      // refusal. It stays on purpose, defence in depth: a refusal the scorer reads, never an answer silently dropped.
      serving: (side) => (put(side) ? TAKEN : refusing('notNow')),
    }),
    [tap, put],
  );
  const refuseScore = useCallback(() => say(refusalLine('scoring.refusal.invalidScore')), [say]);
  const snapshot = useMemo<TableTennisSheetSnapshot | null>(
    () =>
      pad === null
        ? null
        : { display: pad.display, history: pad.history, card: pad.view.card, ask: pad.ask },
    [pad],
  );
  const sheets = useTableTennisSheets(driver, snapshot, opening, refuseScore);
  useClosedByDeadLink(pad?.view, sheets.open, sheets.cancel);
  return sheets;
}

type Parts = {
  readonly sender: Sender;
  readonly runner: ScoringRunner | null;
  readonly pad: PadFacts | null;
  readonly taps: ReturnType<typeof useTaps>;
  readonly sheets: ReturnType<typeof useSheets>;
  readonly setCardNote: (note: MessageKey | null) => void;
};

function useActions(parts: Parts): TableTennisPadActions {
  const { taps, sheets } = parts;
  const home = useBackToHome();
  const start = useStart(parts);
  const asked = useAsk(parts);
  const links = useLinks(parts.runner, parts.setCardNote);
  const tool = useTool(parts);
  const { tapHalf, undo } = taps;
  return useMemo(
    () => ({ home, tapHalf, undo, ...sheets.actions, tool, ...asked, ...links, ...start }),
    [home, tapHalf, undo, tool, sheets.actions, asked, links, start],
  );
}

/** Start match is a tap carrying the side picked to serve first (ruling 49), through the bounce memory. */
function useStart({ sender, runner, pad, taps }: Parts) {
  const { tap } = sender;
  const startWith = useCallback((server: PadSide) => tap({ kind: 'start', server }), [tap]);
  return useStartActions(runner, pad?.toss ?? null, startWith, taps.opening);
}

/** The reconnect question's answers (owner ruling 43), the same for every sport (`useAskActions`). */
function useAsk({ sender, taps, sheets }: Parts) {
  return useAskActions(sender.answer, taps.opening, sheets.justShown, sheets.actions.askDiscard);
}

/** 13 returns in the bounce memory's own name, apart from the halves': a repeat of it counts once. */
const RETURNS_TAP = 'returns';

/**
 * A tool: 13 returns is a point at once, for the receiver its cell was drawn for (its id names the side, so a press that
 * lands after the serve changed is the fold's to refuse, never another side's point); every other tool opens its sheet.
 * Either is quiet on the heels of a sheet's recording (`useGuardedTool`): the second touch of a double tap.
 */
function useTool({ sender, taps, sheets }: Parts) {
  const { tap } = sender;
  const { point } = taps;
  const openSheet = sheets.actions.tool;
  const press = useCallback(
    (id: string) => {
      const parsed = parseTableTennisTool(id);
      if (parsed === null || !('returns' in parsed)) return openSheet(id);
      const side = parsed.returns;
      point(RETURNS_TAP, side, () => tap({ kind: 'returns', side }));
    },
    [tap, point, openSheet],
  );
  return useGuardedTool(taps.secondTouch, press);
}
