import { useCallback, useMemo, useState } from 'react';
import type { BadmintonPadKey, BadmintonSanction } from '@/domain/scoring/badmintonPad';
import { badmintonSport, type BadmintonTypes } from '@/domain/scoring/badmintonSport';
import { refusalLine } from '@/domain/scoring/padLine';
import type { PadSide } from '@/domain/scoring/padView';
import type { MatchPad } from '@/domain/scoring/scoringMatchView';
import type { HalfFlash } from '@/domain/scoring/tapFlash';
import type { PadActions, PadScreenModel, ScoringMatch } from '@/hooks/padScreenModel';
import type { ScoringRunner } from '@/hooks/scoringRunner';
import { useBackCloses } from '@/hooks/useBackCloses';
import {
  usePadSheets,
  type PadSheetDriver,
  type PadSheetSnapshot,
  type PadSheetView,
} from '@/hooks/usePadSheets';
import { useAskActions, useClosedByDeadLink, useStartActions } from '@/hooks/usePadMatchParts';
import { useGuardedTool, useSettle, useTaps } from '@/hooks/usePadTaps';
import { usePointCallFault } from '@/hooks/usePointCallFault';
import type { Ports } from '@/hooks/usePorts';
import { useLinks, useScoringMatch, useSender, type MatchSender } from '@/hooks/useScoringMatch';
import { useBackToHome } from '@/hooks/useStreamLinks';
import type { MessageKey } from '@/i18n/messages';

/**
 * A badminton match on the pad screen (plan S2-1 Task 9): the generic match (`useScoringMatch`) with badminton's pad
 * hook. What is badminton's here: a half is a rally, Start match carries the picked server, the sheets are Sanction and
 * Set score (`usePadSheets`), and a disqualification waits for its ending (record it, or void the sanction).
 */

/**
 * Badminton's own buttons, beside every pad's (`PadActions`): a sanction's steps and Set score (its sheets), the
 * ending prompt, and the Start screen.
 */
export type BadmintonPadActions = PadActions & {
  readonly choose: (id: string) => void;
  readonly saveScore: (first: string, second: string) => void;
  readonly recordEnding: () => void;
  readonly voidSanction: () => void;
  /** The Start screen (owner, 2026-11-01, option A): who serves first, picked; then Start match, a tap. */
  readonly pickServer: (side: PadSide) => void;
  readonly start: () => void;
  /**
   * The reconnect question (owner ruling 43): Send my taps, Discard them (which asks again) and its confirm's Discard.
   * Keep, the confirm's other button, is the shared `dismiss`.
   */
  readonly sendTaps: () => void;
  readonly askDiscard: () => void;
  readonly confirmDiscard: () => void;
};

/** What the badminton pad screen is drawn from: the real match's (`useBadmintonMatch`) and the preview's. */
export type BadmintonPadModel = PadScreenModel<BadmintonPadKey, PadSheetView> & {
  /** The Start screen's pick of who serves first; none until the scorer picks, and none once the match starts. */
  readonly toss: PadSide | null;
  readonly actions: BadmintonPadActions;
};

export function useBadmintonMatch(fixtureId: string): ScoringMatch<BadmintonPadModel> {
  return useScoringMatch(fixtureId, badmintonSport, useBadmintonPad);
}

type PadFacts = MatchPad<BadmintonTypes>;
type Sender = MatchSender<BadmintonTypes>;

function useBadmintonPad(
  ports: Ports,
  runner: ScoringRunner | null,
  pad: PadFacts | null,
): BadmintonPadModel | null {
  const sender = useSender<BadmintonTypes>(ports, runner);
  usePointCallFault(ports.logger, pad?.display.callFault);
  const [flash, setFlash] = useState<HalfFlash>(null);
  const [cardNote, setCardNote] = useState<MessageKey | null>(null);
  const settle = useSettle(sender.say);
  const driver = useMemo(
    () => ({
      rally: (side: PadSide) => sender.tap({ kind: 'rally', side }),
      undo: () => sender.undo(),
    }),
    [sender],
  );
  const taps = useTaps(driver, settle, sender.say, setFlash);
  const sheets = useSheets(sender, taps.opening, pad);
  const actions = useActions({ sender, runner, pad, taps, sheets, setCardNote });
  useBackCloses(sheets.open, sheets.cancel);
  return useMemo(
    () =>
      pad === null
        ? null
        : {
            kind: 'pad',
            view: pad.view,
            sheet: sheets.view,
            line: pad.line,
            cardNote,
            flash,
            toss: pad.toss,
            actions,
          },
    [pad, sheets.view, cardNote, flash, actions],
  );
}

/** The sheets over the pad: closed at once when the link dies, since the bad-link card then shows (round 8 hardening). */
function useSheets(
  sender: Sender,
  opening: ReturnType<typeof useTaps>['opening'],
  pad: PadFacts | null,
) {
  const { tap, say } = sender;
  const driver = useMemo<PadSheetDriver>(
    () => ({
      sanction: (sanction: BadmintonSanction) => tap({ kind: 'sanction', ...sanction }),
      setScore: (first, second) => tap({ kind: 'setScore', first, second }),
    }),
    [tap],
  );
  const refuseScore = useCallback(() => say(refusalLine('scoring.refusal.invalidScore')), [say]);
  const snapshot = useMemo<PadSheetSnapshot | null>(
    () =>
      pad === null
        ? null
        : { display: pad.display, history: pad.history, card: pad.view.card, ask: pad.ask },
    [pad],
  );
  const sheets = usePadSheets(driver, snapshot, opening, refuseScore);
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

function useActions(parts: Parts): BadmintonPadActions {
  const { taps, sheets } = parts;
  const home = useBackToHome();
  const start = useStart(parts);
  const ending = useEnding(parts);
  const asked = useAsk(parts);
  const links = useLinks(parts.runner, parts.setCardNote);
  const tool = useGuardedTool(taps.secondTouch, sheets.actions.tool);
  const { tapHalf, undo } = taps;
  return useMemo(
    () => ({
      home,
      tapHalf,
      undo,
      ...sheets.actions,
      tool,
      ...ending,
      ...asked,
      ...links,
      ...start,
    }),
    [home, tapHalf, undo, tool, sheets.actions, ending, asked, links, start],
  );
}

/** The Start screen: the pick goes to the match, and Start match is a tap carrying it, through the bounce memory. */
function useStart({ sender, runner, pad, taps }: Parts) {
  const { tap } = sender;
  const startWith = useCallback((server: PadSide) => tap({ kind: 'start', server }), [tap]);
  return useStartActions(runner, pad?.toss ?? null, startWith, taps.opening);
}

/** The ending prompt's buttons: quiet in the bounce window of the prompt appearing, each an opening tap. */
function useEnding({ sender, pad, taps, sheets }: Parts) {
  const { tap, undo } = sender;
  const { opening } = taps;
  const { justShown } = sheets;
  const waiting = pad?.display.awaitingEnding === true ? pad.display.sanctions.at(-1) : undefined;
  const recordEnding = useCallback(() => {
    if (waiting === undefined || justShown()) return;
    opening('ending', () => tap({ kind: 'ending', side: waiting.side, person: waiting.person }));
  }, [waiting, opening, tap, justShown]);
  const voidSanction = useCallback(() => {
    if (!justShown()) opening('void', () => undo('ending'));
  }, [opening, undo, justShown]);
  return useMemo(() => ({ recordEnding, voidSanction }), [recordEnding, voidSanction]);
}

/** The reconnect question's answers (owner ruling 43), the same for every sport (`useAskActions`). */
function useAsk({ sender, taps, sheets }: Parts) {
  return useAskActions(sender.answer, taps.opening, sheets.justShown, sheets.actions.askDiscard);
}
