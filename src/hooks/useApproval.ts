import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApprovalReview } from '@/domain/matchday/approvalWire';
import type { ApprovalKind } from '@/domain/matchday/matchDay';
import { dayCodeOf, type SavedDayCode } from '@/domain/mode/dayCode';
import type { SavedCode } from '@/domain/mode/savedCode';
import { leaveDay } from '@/hooks/useMatchDay';
import { askDay, refusalVerdict } from '@/hooks/useMatchDayHome';
import { usePorts, type Ports } from '@/hooks/usePorts';
import type { PortAnswer } from '@/services/matchDayPort';

/** S4 design §9: a review that answers offline (a 429 among it) is asked once more after this, then it is offline. */
export const REVIEW_RETRY_MS = 1000;

/**
 * `loading`: the review is being read; `ready`: the server's proposal, read-only; `approving`: an approve is out;
 * `done`: approved (this phone's, or one that landed though it answered offline); `refused`: the server will not take
 * it from the phone, and `refusal` says why; `offline`: no answer the phone can act on, and Review again asks.
 */
export type ApprovalState = 'loading' | 'ready' | 'approving' | 'done' | 'refused' | 'offline';

/**
 * What the screen says besides the rows: `stale` (the proposal changed; the review was read again), `already` (another
 * phone approved first), `ties` (only the web desk decides them), `onWeb` (the phone cannot take this one: refused
 * twice as stale, or the code may not approve it) and `offline` (an approve that did not get through, the day read
 * again and the stage still waiting).
 */
export type ApprovalRefusal = 'stale' | 'already' | 'ties' | 'onWeb' | 'offline';

export type ApprovalView = {
  readonly review: ApprovalReview | null;
  readonly state: ApprovalState;
  readonly refusal: ApprovalRefusal | null;
  /** The hold is offered: a proposal in hand, nothing out, nothing that only the web desk can do. */
  readonly holdable: boolean;
  /** The 3 s hold's action: one approve at a time, and only while `holdable`. */
  readonly approve: () => void;
  /** One more read of the review (the only way to one besides opening the screen). */
  readonly reviewAgain: () => void;
};

/** What the approval needs of the list beneath: read the day again, and close the review. */
export type ApprovalSink = { readonly refresh: () => void; readonly close: () => void };

type Shown = {
  readonly state: ApprovalState;
  readonly review: ApprovalReview | null;
  readonly refusal: ApprovalRefusal | null;
};
type Flags = {
  reading: boolean;
  approving: boolean;
  /** The last approve was refused as stale and the review has been read again since. */
  afterStale: boolean;
  /** The last approve answered offline and the day has not been read since: it may have landed. */
  recheck: boolean;
};
type Held = { readonly saved: SavedCode; readonly code: SavedDayCode };
type Failed = Extract<PortAnswer<never>, { ok: false }>;
/** A refusal the screen shows, or `leave`: the code itself has gone, and the day's own handling takes over. */
type Meaning = ApprovalRefusal | 'leave';

const OFFLINE: Failed = { ok: false, offline: true };
/** The code has gone (the day's handling takes over) or the web desk's: no hold, no rows. */
const GONE_TO_WEB: Shown = { state: 'refused', review: null, refusal: 'onWeb' };
const LOADING: Shown = { state: 'loading', review: null, refusal: null };

/**
 * Whether the proposal can be approved from the phone: read, with nothing for the web desk. A Swiss proposal with no
 * round has none to hand back (the approve would be refused 422), so it is not offered (the controller's ruling).
 */
export function isHoldable(review: ApprovalReview | null): review is ApprovalReview {
  return review !== null && !review.ties && !(review.kind === 'swiss' && review.round === null);
}

/**
 * Review and approve one stage's draw (S4 design §7; MD-2 Task 6). One GET of the review as the screen opens and one on
 * Review again, never a poll (it writes, and is budgeted 1/s per code); an offline answer is asked once more after 1 s.
 *
 * An approve answers one of: approved (the day is read again at once and the review closes), MD_ALREADY, MD_STALE (the
 * review is read again once; a second stale straight after that fresh review sends the arbiter to the web desk, never a
 * loop), MD_TIES, any other refusal (the web desk), or offline, which may still have landed: the day is read again, and
 * the hold is offered only while the stage still waits. A code that has ended or been withdrawn is forgotten as the
 * day's read forgets it. The record gets `matchday.approve {kind, stage, outcome}`, never a token or a hash.
 */
export function useApproval(kind: ApprovalKind, stageId: string, sink: ApprovalSink): ApprovalView {
  const ports = usePorts();
  const [shown, setShown] = useState<Shown>(LOADING);
  const latest = useRef(shown);
  const flags = useRef<Flags>({
    reading: false,
    approving: false,
    afterStale: false,
    recheck: false,
  });
  const mounted = useMounted();
  const sinkRef = useRef(sink);
  useEffect(() => {
    sinkRef.current = sink;
    latest.current = shown;
  });
  const asks = useAsks({ ports, kind, stageId, flags, mounted, sinkRef, setShown });
  useEffect(() => {
    void asks.load(null);
  }, [asks]);
  const { approveFrom, reviewAgain } = asks;
  const approve = useCallback(() => approveFrom(latest.current), [approveFrom]);
  const holdable = shown.state === 'ready' && isHoldable(shown.review);
  return { ...shown, holdable, approve, reviewAgain };
}

type Deps = {
  readonly ports: Ports;
  readonly kind: ApprovalKind;
  readonly stageId: string;
  readonly flags: { readonly current: Flags };
  readonly mounted: { readonly current: boolean };
  readonly sinkRef: { readonly current: ApprovalSink };
  readonly setShown: (next: Shown) => void;
};
type Load = (notice: ApprovalRefusal | null) => Promise<void>;
type Approving = Deps & { readonly load: Load };

/** The three asks, built once for the screen's life: its effect reads once, and nothing here changes with a render. */
function useAsks(deps: Deps) {
  const { ports, kind, stageId, flags, mounted, sinkRef, setShown } = deps;
  return useMemo(() => {
    const load: Load = async (notice) => {
      const held = heldCode(ports);
      // No day code to ask with (Exit forgot it, or this build cannot address it): nothing is asked.
      if (held === null) return setShown({ state: 'offline', review: null, refusal: null });
      if (flags.current.reading) return;
      flags.current.reading = true;
      setShown({ state: 'loading', review: null, refusal: notice });
      const answer = await readReview(ports, held.code, kind, stageId, mounted);
      flags.current.reading = false;
      if (mounted.current) settleReview(ports, held, answer, notice, setShown);
    };
    const all: Approving = { ports, kind, stageId, flags, mounted, sinkRef, setShown, load };
    const approveFrom = (now: Shown) => {
      if (flags.current.approving || now.state !== 'ready' || !isHoldable(now.review)) return;
      flags.current.approving = true;
      setShown({ ...now, state: 'approving' });
      void doApprove(all, now.review).finally(() => {
        flags.current.approving = false;
      });
    };
    const reviewAgain = () => {
      void (flags.current.recheck ? recheckThenRead(all) : load(null));
    };
    return { load, approveFrom, reviewAgain };
  }, [ports, kind, stageId, flags, mounted, sinkRef, setShown]);
}

function useMounted(): { readonly current: boolean } {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}

/** The saved day code and the origin and token this build reads from it; none when none can be addressed. */
function heldCode(ports: Ports): Held | null {
  const snapshot = ports.modeStore.getSnapshot();
  const saved = snapshot.status === 'ready' ? snapshot.saved.codes.matchday : undefined;
  const code = saved === undefined ? null : dayCodeOf(saved.raw, ports.hosts);
  return saved === undefined || code === null ? null : { saved, code };
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The review, asked once more after a second when the first answer was offline; never again, and never once gone. */
async function readReview(
  ports: Ports,
  code: SavedDayCode,
  kind: ApprovalKind,
  stageId: string,
  mounted: { readonly current: boolean },
): Promise<PortAnswer<ApprovalReview>> {
  const first = await askReview(ports, code, kind, stageId);
  if (first.ok || !('offline' in first)) return first;
  await wait(REVIEW_RETRY_MS);
  return mounted.current ? askReview(ports, code, kind, stageId) : first;
}

async function askReview(
  ports: Ports,
  code: SavedDayCode,
  kind: ApprovalKind,
  stageId: string,
): Promise<PortAnswer<ApprovalReview>> {
  try {
    return await ports.matchDay.review(code, kind, stageId);
  } catch {
    ports.logger.warn('matchday.review-threw');
    return OFFLINE;
  }
}

function settleReview(
  ports: Ports,
  held: Held,
  answer: PortAnswer<ApprovalReview>,
  notice: ApprovalRefusal | null,
  setShown: (next: Shown) => void,
): void {
  if (answer.ok) return setShown({ state: 'ready', review: answer.value, refusal: notice });
  if ('offline' in answer) return setShown({ state: 'offline', review: null, refusal: null });
  const meaning = meaningOf(answer, false);
  if (meaning === 'leave') return leave(ports, held, answer, setShown);
  setShown({ state: 'refused', review: null, refusal: meaning });
}

/** What a refusal says to the arbiter. A stale review is the web desk's: only an approve can be stale. */
function meaningOf(answer: Failed, afterApprove: boolean): Meaning {
  if ('gone' in answer || !('refusal' in answer)) return 'onWeb';
  switch (answer.refusal) {
    case 'MD_ALREADY':
      return 'already';
    case 'MD_TIES':
      return 'ties';
    case 'MD_STALE':
      return afterApprove ? 'stale' : 'onWeb';
    case 'MD_ENDED':
    case 'MD_WITHDRAWN':
    case 'MD_UNKNOWN':
    case 'MD_NOT_OPEN':
      return 'leave';
    default:
      return 'onWeb';
  }
}

/** The code has ended, been withdrawn, is unknown or not open: forgotten exactly as the day's read forgets it. */
function leave(ports: Ports, held: Held, answer: Failed, setShown: (next: Shown) => void): void {
  setShown(GONE_TO_WEB);
  const verdict = refusalVerdict(answer);
  if (verdict.kind === 'stop' || verdict.kind === 'notYet') {
    void leaveDay(ports, held.saved, verdict).catch(() =>
      ports.logger.warn('matchday.leave-failed'),
    );
  }
}

async function doApprove(deps: Approving, review: ApprovalReview): Promise<void> {
  const { ports, kind, stageId, setShown } = deps;
  const held = heldCode(ports);
  if (held === null) return setShown({ state: 'offline', review, refusal: null });
  // A draw has no round; a Swiss review's is the one the approve hands back (isHoldable has seen it is there).
  const round = kind === 'swiss' ? review.round : null;
  const answer = await askApprove(ports, held.code, { kind, stageId, hash: review.hash, round });
  // The word is recorded whether or not the screen is still there: the approve may have landed.
  const outcome = outcomeOf(answer);
  // `sid` and `result` are the allow-list's own words (`scrub.ts`, shared with native and the web's record contract): a
  // string under a key it does not list is masked, so `stage` and `outcome` would read "***". The stage id is a plain word.
  ports.logger.info('matchday.approve', { kind, sid: stageId, result: outcome });
  if (answer.ok) return approved(deps);
  const meaning = meaningOf(answer, true);
  // The answer says the code is over, whether or not the review is still open: it is forgotten as the day read forgets it.
  if (meaning === 'leave') return leave(ports, held, answer, setShown);
  if ('offline' in answer) return recheckAfterOffline(deps, review);
  deps.sinkRef.current.refresh();
  if (!deps.mounted.current) return;
  if (meaning === 'stale') return reloadAfterStale(deps);
  setShown({ state: 'refused', review: meaning === 'ties' ? review : null, refusal: meaning });
}

function outcomeOf(answer: PortAnswer<unknown>): string {
  if (answer.ok) return 'approved';
  if ('offline' in answer) return 'offline';
  if ('gone' in answer) return 'gone';
  return answer.refusal === 'MD_STALE' ? 'stale' : answer.refusal;
}

async function askApprove(
  ports: Ports,
  code: SavedDayCode,
  call: { kind: ApprovalKind; stageId: string; hash: string; round: number | null },
) {
  try {
    return await ports.matchDay.approve(code, call.kind, call.stageId, call.hash, call.round);
  } catch {
    ports.logger.warn('matchday.approve-threw');
    return OFFLINE;
  }
}

/** Approved: the day is read again at once (the new matches are on their courts), and the review closes. */
function approved(deps: Deps): void {
  deps.sinkRef.current.refresh();
  if (!deps.mounted.current) return;
  deps.setShown({ state: 'done', review: null, refusal: null });
  deps.sinkRef.current.close();
}

/**
 * MD_STALE: the review is read again, once. A second stale straight after that fresh review is the web desk's, never
 * an endless "review again".
 */
async function reloadAfterStale(deps: Approving): Promise<void> {
  const { flags, load, setShown } = deps;
  if (flags.current.afterStale) {
    return setShown(GONE_TO_WEB);
  }
  flags.current.afterStale = true;
  await load('stale');
}

/**
 * An approve that answered offline may still have landed. The day is read again before the hold is offered: gone from
 * its approvals, it landed; still there, the hold is offered again with the line "Offline"; with no day to read, the
 * hold stays away and Review again reads the day first.
 */
async function recheckAfterOffline(deps: Approving, review: ApprovalReview): Promise<void> {
  if (!deps.mounted.current) return;
  deps.flags.current.recheck = true;
  const seen = await readStage(deps);
  if (!deps.mounted.current) return;
  if (seen === 'left') return deps.setShown(GONE_TO_WEB);
  if (seen === 'unknown') return deps.setShown({ state: 'offline', review, refusal: null });
  deps.flags.current.recheck = false;
  if (seen === 'gone') return approved(deps);
  deps.setShown({ state: 'ready', review, refusal: 'offline' });
}

/** Review again after an offline approve: the day first (it may have landed), and only then the review. */
async function recheckThenRead(deps: Approving): Promise<void> {
  const seen = await readStage(deps);
  if (!deps.mounted.current || seen === 'unknown') return;
  if (seen === 'left') return deps.setShown(GONE_TO_WEB);
  deps.flags.current.recheck = false;
  if (seen === 'gone') return approved(deps);
  await deps.load(null);
}

/**
 * Whether the stage still waits on the day, read now: `listed`, `gone` (approved), `unknown` (no answer) or `left` (the
 * code has gone and the day's handling took over).
 */
async function readStage(deps: Deps): Promise<'listed' | 'gone' | 'unknown' | 'left'> {
  const { ports, kind, stageId } = deps;
  const held = heldCode(ports);
  if (held === null) return 'unknown';
  const verdict = await askDay(ports, held.code);
  if (verdict.kind === 'offline') return 'unknown';
  if (verdict.kind !== 'open') {
    await leaveDay(ports, held.saved, verdict).catch(() =>
      ports.logger.warn('matchday.leave-failed'),
    );
    return 'left';
  }
  const listed = verdict.day.approvals.some((a) => a.kind === kind && a.stageId === stageId);
  return listed ? 'listed' : 'gone';
}
