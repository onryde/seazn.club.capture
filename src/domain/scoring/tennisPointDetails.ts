import { tennisPadRules } from '@seazn/engine/pad';
import { isRecord } from '@/domain/credentials/wire';
import type { PadSide, PadTool } from '@/domain/scoring/padView';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { SportLine } from '@/domain/scoring/scoringSport';
import { standing, type VoidableEvent } from '@/domain/scoring/setBasedEvents';
import type { TennisPadKey } from '@/domain/scoring/tennisTypes';

/**
 * A point's details (S2-7 ruling 234, the owner's): with the match's "Point details" switch on, a point is held unsent for a
 * moment while chips show, Ace, Double fault, Winner and Error, and a chip tags it (`meta.kind`); the point carries `server`
 * when the engine names the server. Off by default, and off it is ruling 217's `{by}` alone, sent at once. Pure: the hold is
 * the queue's (`QueuedEvent.holdUntil`, `amendQueued`), the switch the hook's.
 */

/**
 * How long a detailed point waits for a chip: the web pad's hold, `HOLD_MS_DEFAULT` (10 000 ms,
 * apps/web/src/components/v2/scorepad/queue.ts:150), mirrored.
 */
export const POINT_DETAILS_HOLD_MS = 10_000;

/** The engine's point kinds (`NestedPointKind`, dist/sports/nested/kernel.js:118): `ue` is an unforced error. */
export type TennisPointKind = 'ace' | 'double_fault' | 'winner' | 'ue';

const KINDS: readonly TennisPointKind[] = ['ace', 'double_fault', 'winner', 'ue'];
const isPointKind = (kind: string): kind is TennisPointKind =>
  (KINDS as readonly string[]).includes(kind);

/**
 * The chips a point to `by` may take, in the engine's order (`tennisPadRules.pointKinds`): an ace is the server's point and a
 * double fault the receiver's (the web's `buildDock`), so neither is offered when the engine names no server (`serving`
 * null); Winner and Error are any side's.
 */
export function pointChips(serving: PadSide | null, by: PadSide): readonly TennisPointKind[] {
  return tennisPadRules.pointKinds.filter(isPointKind).filter((kind) => {
    if (kind === 'ace') return serving === by;
    if (kind === 'double_fault') return serving !== null && serving !== by;
    return true;
  });
}

const CHIP = 'chip.';

/** The drawn word of each chip; the ruling's "Error" is said in full (`errorSaid`), as the web words it. */
const CHIP_LABEL: Readonly<Record<TennisPointKind, TennisPadKey>> = {
  ace: 'scoring.tennis.chip.ace',
  double_fault: 'scoring.tennis.chip.doubleFault',
  winner: 'scoring.tennis.chip.winner',
  ue: 'scoring.tennis.chip.error',
};

/** The chips as the tool row draws them, in the tools' place while the point is held. */
export function chipTools(kinds: readonly TennisPointKind[]): PadTool<TennisPadKey>[] {
  return kinds.map((kind) => ({
    id: `${CHIP}${kind}`,
    label: { key: CHIP_LABEL[kind] },
    ...(kind === 'ue' ? { said: { key: 'scoring.tennis.chip.errorSaid' as const } } : {}),
    detail: null,
    kind: 'standard',
    enabled: true,
  }));
}

/** The point kind a tool id names, or null for any other tool. */
export function chipOf(id: string): TennisPointKind | null {
  if (!id.startsWith(CHIP)) return null;
  const kind = id.slice(CHIP.length);
  return isPointKind(kind) ? kind : null;
}

/** The held point's payload tagged with `kind`, its other fields (and any `meta` field) kept. */
export function withPointKind(payload: unknown, kind: TennisPointKind): unknown {
  if (!isRecord(payload)) return payload;
  const meta = isRecord(payload.meta) ? payload.meta : {};
  return { ...payload, meta: { ...meta, kind } };
}

/**
 * The events standing that move the serve: points, set scores and awarded games. A toss moves it too, but only one stands
 * in a match, so it is read by the side it names (`serveMark`), not counted.
 */
export const serveEventsIn = (events: readonly VoidableEvent[]): number =>
  standing(events, 'tennis.point', 'tennis.set_summary', 'tennis.game.award').length;

/** How the toss stands for a point to one side: none, naming that side to serve first, or naming the other. */
export type TossMark = 'none' | 'by' | 'other';
const TOSS_MARKS: readonly TossMark[] = ['none', 'by', 'other'];

/**
 * What a detailed point was judged on, as one number (`QueuedEvent.base`): the serve events standing, and how the toss
 * stood. Two phones racing Start each queue a toss and one is refused, so a point held on this phone's toss is judged on a
 * serve that never stood though the count is the same: the toss's side tells them apart.
 */
export const serveMark = (serveEvents: number, toss: TossMark): number =>
  serveEvents * TOSS_MARKS.length + TOSS_MARKS.indexOf(toss);

type PayloadEvent = VoidableEvent & { readonly payload: unknown };

/** The toss standing in a ledger, read against the entrant a point is to (`by`). */
function tossIn(ledger: readonly PayloadEvent[], by: unknown): TossMark {
  const toss = standing(ledger, 'tennis.toss').at(-1);
  if (toss === undefined) return 'none';
  return isRecord(toss.payload) && toss.payload.serving === by ? 'by' : 'other';
}

/**
 * A detailed point's payload at its send: as queued, unless the serve it was judged on no longer stands: serve events
 * landed that it was not made on (another scorer's point while it was held), or another phone's toss stands where this
 * phone's was (a race to Start). Its `server` and its kind were then judged on another serve, so it goes as the side alone,
 * the point still counted. As queued while the ledger holds its copy (the web matches a resend by key, never by payload),
 * and for a tap with no mark (a plain point, any other tap).
 */
export function pointDetailsForSend(
  queued: QueuedEvent,
  ledger: readonly PayloadEvent[],
  copied: boolean,
): unknown {
  const { payload, base } = queued;
  if (base === undefined || copied || !isRecord(payload)) return payload;
  const now = serveMark(serveEventsIn(ledger), tossIn(ledger, payload.by));
  return now === base ? payload : { by: payload.by };
}

/** The record's word when a detailed point goes without what was judged on a serve that no longer stands. */
const SERVE_MOVED: SportLine = {
  event: 'scoring.point-detail-dropped',
  fields: { reason: 'serveMoved' },
};

/**
 * The record's line for a point sent with less than it was queued with (`pointDetailsForSend` took its `server` and kind):
 * the scorer's chip, if any, never reaches Seazn, and the record says so once, with no payload. A point already sent as
 * the side alone has nothing left to lose and says nothing again.
 */
export function pointDetailsNote(queued: QueuedEvent, payload: unknown): SportLine | null {
  const before = queued.payload;
  if (!isRecord(before) || !isRecord(payload)) return null;
  return Object.keys(payload).length < Object.keys(before).length ? SERVE_MOVED : null;
}
