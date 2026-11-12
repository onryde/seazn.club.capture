import { tennisPadRules } from '@seazn/engine/pad';
import { isRecord } from '@/domain/credentials/wire';
import type { PadSide, PadTool } from '@/domain/scoring/padView';
import type { QueuedEvent } from '@/domain/scoring/queue';
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
 * The events standing that move the serve: points, set scores and awarded games. A detailed point carries this count from
 * its making (`QueuedEvent.base`) so its send can tell whether the serve it was judged on still stands.
 */
export const serveEventsIn = (events: readonly VoidableEvent[]): number =>
  standing(events, 'tennis.point', 'tennis.set_summary', 'tennis.game.award').length;

/**
 * A detailed point's payload at its send: as queued, unless serve events landed that it was not made on (another scorer's
 * point while it was held): its `server` and its kind were judged on another point, so it goes as the side alone, the
 * point still counted. As queued while the ledger holds its copy (the web matches a resend by key, never by payload), and
 * for a tap with no count (a plain point, any other tap).
 */
export function pointDetailsForSend(
  queued: QueuedEvent,
  ledger: readonly VoidableEvent[],
  copied: boolean,
): unknown {
  const { payload, base } = queued;
  if (base === undefined || copied || serveEventsIn(ledger) === base) return payload;
  return isRecord(payload) ? { by: payload.by } : payload;
}
