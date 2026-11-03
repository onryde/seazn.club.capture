import { isRecord } from '@/domain/credentials/wire';
import type { MatchContext } from '@/domain/scoring/matchContext';
import type { PadHalf, PadSide, PadSync, PadView } from '@/domain/scoring/padView';
import type { ScoringSport, SportFold, SportFoldInput } from '@/domain/scoring/scoringSport';
import { matchContextOf } from '@/domain/scoring/wire';

// A made-up sport no build ships, "first to 3", for the tests that prove the match runtime is sport-agnostic (owner,
// 2026-11-02: "pad per sport must"): a tap is a point to a side, the first side to 3 wins, and nothing else. It shares
// no code with badminton. Its key is `first3` and its engine epoch 7, so a send shows which sport made it.

type Point = { readonly side: PadSide };
type FirstTo3Key = 'first3.point' | 'first3.undone' | 'first3.hint' | 'first3.tally';
type FirstTo3Display = {
  readonly points: Readonly<Record<PadSide, number>>;
  readonly context: MatchContext;
  readonly lastTap: { readonly kind: 'point' | 'undone'; readonly side: PadSide } | null;
};
export type FirstTo3 = {
  readonly tap: Point;
  readonly display: FirstTo3Display;
  readonly padKey: FirstTo3Key;
  readonly undone: PadSide;
};

const POINT = 'first3.point';
const VOID = 'core.void';

const sideOf = (payload: unknown): PadSide | null =>
  isRecord(payload) && (payload.side === 'first' || payload.side === 'second')
    ? payload.side
    : null;

const voidedBy = (payload: unknown): string | null =>
  isRecord(payload) && typeof payload.event_id === 'string' ? payload.event_id : null;

/** The ledger's standing points, then each queued tap judged on them: a point while nobody has 3, a void of one standing. */
function foldFirstTo3({ bootstrap, ledger, queued }: SportFoldInput): SportFold<FirstTo3> {
  const voided = new Set(ledger.flatMap((event) => (event.voids === null ? [] : [event.voids])));
  const standing = new Map<string, PadSide>();
  for (const event of ledger) {
    const side = event.type === POINT && !voided.has(event.id) ? sideOf(event.payload) : null;
    if (side !== null) standing.set(event.id, side);
  }
  const points = { first: 0, second: 0 };
  standing.forEach((side) => (points[side] += 1));
  let lastTap: FirstTo3Display['lastTap'] = null;
  const legalQueued: string[] = [];
  for (const tap of queued) {
    const target = tap.type === VOID ? voidedBy(tap.payload) : null;
    const taken = target === null ? undefined : standing.get(target);
    const side = tap.type === POINT ? sideOf(tap.payload) : null;
    if (target !== null && taken !== undefined) {
      standing.delete(target);
      points[taken] -= 1;
    } else if (side !== null && Math.max(points.first, points.second) < 3) {
      points[side] += 1;
      lastTap = { kind: 'point', side };
    } else continue;
    legalQueued.push(tap.key);
  }
  const display = { points, context: matchContextOf(bootstrap) ?? CONTEXT, lastTap };
  return { kind: 'folded', display, legalQueued, history: [] };
}

const CONTEXT: MatchContext = {
  competition: 'Made-up Cup',
  division: null,
  round: null,
  match: null,
  sides: ['Top', 'Bottom'],
};

function half(display: FirstTo3Display, side: PadSide): PadHalf<FirstTo3Key> {
  return {
    side,
    label: display.context.sides[side === 'first' ? 0 : 1],
    value: String(display.points[side]),
    periods: null,
    sub: null,
    serving: null,
    bar: 'dim',
    hint: { key: 'first3.hint' },
    hintLine: { key: 'first3.hint' },
    tappable: true,
  };
}

function padFirstTo3(display: FirstTo3Display, sync: PadSync): PadView<FirstTo3Key> {
  const { lastTap } = display;
  return {
    halves: [half(display, 'first'), half(display, 'second')],
    tally: { shown: '0:0', said: { key: 'first3.tally' } },
    details: { context: display.context, rules: [] },
    start: null,
    strip: [],
    lastTap:
      lastTap === null
        ? null
        : { text: { key: `first3.${lastTap.kind}`, vars: { side: lastTap.side } }, undo: true },
    sync,
    tools: [],
    card: null,
  };
}

export const firstTo3: ScoringSport<FirstTo3> = {
  key: 'first3',
  epoch: 7,
  fold: foldFirstTo3,
  eventFor: (tap) => ({ type: POINT, payload: { side: tap.side } }),
  /** What the pump sends, marked, so a send shows it was this sport's decision. */
  payloadForSend: (queued, ledger) =>
    isRecord(queued.payload) ? { ...queued.payload, seen: ledger.length } : queued.payload,
  tossOf: () => null,
  refusalFor: () => 'notNow',
  notStarted: () => false,
  decided: (display) => Math.max(display.points.first, display.points.second) >= 3,
  resultLine: (display) => `${display.points.first}–${display.points.second}`,
  awaitingEnding: () => false,
  undoneOf: (display) => (display.lastTap?.kind === 'point' ? display.lastTap.side : null),
  showUndone: (display, side) => ({ ...display, lastTap: { kind: 'undone', side } }),
  pad: padFirstTo3,
};
