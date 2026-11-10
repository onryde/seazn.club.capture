import {
  EngineError,
  foldMatch,
  foldMatchWithStoppage,
  gameTimeOf,
  type EventEnvelope,
} from '@seazn/engine/core';
import { footballPadRules } from '@seazn/engine/pad';
import {
  football,
  footballNextKicker,
  shootoutTally,
  type FootballState,
} from '@seazn/engine/sports/football';
import { isRecord } from '@/domain/credentials/wire';
import {
  anchorBase,
  anchorOf,
  newestStamp,
  overtaken,
  periodStarted,
  correctionsIn,
  restamp,
  subStamp,
  type AnchorEvent,
} from '@/domain/scoring/footballClock';
import {
  footballCfg,
  footballRefusalOf,
  type FootballEngineMatch,
} from '@/domain/scoring/footballEngine';
import {
  footballHistory,
  periodWordOf,
  type FootballHistoryEntry,
} from '@/domain/scoring/footballHistory';
import {
  ENGINE_SIDE,
  otherSide,
  seatOf,
  type FootballDisplay,
  type FootballDone,
  type FootballMarker,
  type FootballPadPhase,
  type FootballPeriodWord,
  type FootballPlayer,
  type FootballShootout,
  type FootballSide,
  type FootballTypes,
} from '@/domain/scoring/footballTypes';
import type { MatchContext } from '@/domain/scoring/matchContext';
import type { PadSide } from '@/domain/scoring/padView';
import type { QueuedEvent } from '@/domain/scoring/queue';
import type { SportFold, SportFoldInput, Unfoldable } from '@/domain/scoring/scoringSport';
import { lastTapOf } from '@/domain/scoring/setBasedBoard';
import { envelopeOf, queuedEnvelopeOf } from '@/domain/scoring/setBasedEngine';
import { voidedIn, voidsAgain } from '@/domain/scoring/setBasedFold';
import type { LedgerEntry } from '@/domain/scoring/setBasedLedgerHistory';
import { seatsOf, type Seats } from '@/domain/scoring/setBasedSides';
import { teamSheetOf } from '@/domain/scoring/teamSheet';
import { undoTarget } from '@/domain/scoring/undoTarget';
import {
  matchContextOf,
  type Bootstrap,
  type BootstrapSide,
  type LedgerEvent,
} from '@/domain/scoring/wire';

/**
 * A football match on the pad (S2-5 design §4, §6, §7; plan P Task 6): the server's ledger with this phone's queued taps
 * on top, folded through the engine's football module, as the pad draws it. The engine decides every fact (the phase, the
 * pitch, the goals, whose kick is next, whether a team may still substitute); this only reads them off.
 *
 * Each queued tap is folded RESTAMPED against the stream before it (design §7.3, ruling 3), as `payloadForSend` will send
 * it, and judged as the server would judge its append: an illegal tap is skipped, never shown, and the ones behind it are
 * judged without it (`legalQueued`, which sync's `revalidate` takes). Without the restamp an offline goal overtaken by a
 * console's later stamp would be refused here (`NON_MONOTONIC_TIME`) and dropped before it was ever sent.
 */

type FootballMatch = {
  readonly engine: FootballEngineMatch;
  readonly seats: Seats;
  readonly sheets: Readonly<Record<PadSide, boolean>>;
  readonly players: Readonly<Record<PadSide, ReadonlyMap<string, FootballPlayer>>>;
  readonly context: MatchContext;
};

type FootballStream = {
  readonly envelopes: EventEnvelope[];
  readonly entries: LedgerEntry[];
  readonly legal: string[];
  /** A queued tap's payload as tapped, by its envelope's id: what the clock's anchor reads (`queuedOnto`). */
  readonly tapped: Map<string, unknown>;
};

/** What the fold says of one event: the period it was recorded in, and the goals after it, top side first. */
export type FootballFacts = {
  readonly period: string;
  readonly after: Readonly<Record<PadSide, number>>;
};

/** An event the pad has words for: what it did, and its facts. */
export type FootballRecorded = { readonly did: FootballDone; readonly facts: FootballFacts };

type FootballFolded = {
  readonly state: FootballState;
  readonly facts: ReadonlyMap<string, FootballFacts>;
};

export function foldFootball(input: SportFoldInput): SportFold<FootballTypes> {
  const match = matchOf(input.bootstrap);
  if (typeof match === 'string') return { kind: 'unfoldable', reason: match };
  const stream = streamOf(match, input);
  const folded = foldOf(match.engine, stream.envelopes);
  if (folded === null) return { kind: 'unfoldable', reason: 'ledger' };
  const anchors = anchorEventsOf(input, stream);
  const corrections = correctionIdsOf(stream, anchors);
  const recorded = withCorrections(recordedOf(match, stream.envelopes, folded.facts), corrections);
  return {
    kind: 'folded',
    display: displayOf(match, input, { stream, folded, recorded, anchors }),
    legalQueued: stream.legal,
    history: footballHistory(historyOf(match, stream, recorded), {
      names: { first: match.seats.first.name, second: match.seats.second.name },
      cfg: match.engine.cfg,
    }),
  };
}

/**
 * History's entries (design §6.4): one for each event the pad has words for, in the match's order, undone where a void
 * takes it back, sending where it is this phone's queued tap, under the period it was recorded in. The engine records the
 * pad's events only in a period, the kicks or (a card) before kick-off, which is the first half's; a phase with no word
 * would keep the period before it.
 */
function historyOf(
  match: FootballMatch,
  stream: FootballStream,
  recorded: ReadonlyMap<string, FootballRecorded>,
): readonly FootballHistoryEntry[] {
  const voided = voidedIn(stream.envelopes);
  let period: FootballPeriodWord = 'H1';
  return stream.entries.flatMap(({ envelope, own, sending }) => {
    const event = recorded.get(envelope.id);
    if (event === undefined) return [];
    period = periodWordOf(event.facts.period, match.engine.cfg) ?? period;
    const { did, facts } = event;
    return [{ did, period, after: facts.after, own, undone: voided.has(envelope.id), sending }];
  });
}

/**
 * The engine's phase after the server's ledger alone (no queued taps), folded with the bootstrap's config and team
 * sheets: what a send judges its stamp against (design §7.3). Null when the bootstrap or the ledger does not fold.
 */
export function footballLedgerPhase(
  bootstrap: Bootstrap,
  ledger: readonly LedgerEvent[],
): string | null {
  const match = matchOf(bootstrap);
  if (typeof match === 'string') return null;
  const envelopes = ledger.map((event) => envelopeOf(match.engine.fixtureId, event));
  return foldOf(match.engine, envelopes)?.state.phase ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// The match: the seats, the team sheets and the players' names
// ---------------------------------------------------------------------------------------------------------------

function matchOf(bootstrap: Bootstrap): FootballMatch | Unfoldable {
  const seats = seatsOf(bootstrap);
  const context = matchContextOf(bootstrap);
  if (seats === null || context === null) return 'sides';
  const cfg = footballCfg(bootstrap.cfg);
  if (cfg === null) return 'cfg';
  const home = teamSheetOf(seats.first);
  const away = teamSheetOf(seats.second);
  return {
    engine: {
      fixtureId: bootstrap.fixtureId,
      cfg,
      lineups: { home: home.lineup, away: away.lineup },
    },
    seats,
    sheets: { first: home.sheet, second: away.sheet },
    players: { first: playersOf(seats.first), second: playersOf(seats.second) },
    context,
  };
}

/** A side's people by id: the name as typed, the shirt number from the team sheet's row, if it has one. */
function playersOf(seat: BootstrapSide): ReadonlyMap<string, FootballPlayer> {
  const numbers = new Map(seat.lineup.map((row) => [row.personId, row.squadNumber ?? null]));
  return new Map(
    seat.members.map((member) => [
      member.personId,
      {
        personId: member.personId,
        name: member.fullName,
        number: numbers.get(member.personId) ?? null,
      },
    ]),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The stream the server would hold
// ---------------------------------------------------------------------------------------------------------------

/** The ledger, then this phone's queued taps on top, as the server would hold them (`queuedOnto`). */
function streamOf(match: FootballMatch, input: SportFoldInput): FootballStream {
  const own = new Set(input.ownEventIds);
  const envelopes = input.ledger.map((event) => envelopeOf(match.engine.fixtureId, event));
  const entries: LedgerEntry[] = envelopes.map((envelope) => ({
    envelope,
    own: own.has(envelope.id),
    sending: false,
  }));
  const stream: FootballStream = { envelopes, entries, legal: [], tapped: new Map() };
  for (const tap of input.queued) queuedOnto(match, input, stream, tap);
  return stream;
}

/**
 * One queued tap onto the stream: restamped against the stream before it, and appended if the server would take it (an
 * illegal tap is skipped, and the ones behind it are judged without it). A clock tap another screen overtook stays the
 * queue's, since its send withdraws it (`overtaken`), but the match is drawn without it. The clock's anchor reads a tap's
 * stamp as tapped, never the one the restamp raised it to, so the phone's clock does not jump while it waits (the
 * controller's ruling, final review, 2026-11-08).
 */
function queuedOnto(
  match: FootballMatch,
  input: SportFoldInput,
  stream: FootballStream,
  tap: QueuedEvent,
): void {
  const { envelopes } = stream;
  if (overtaken(tap, input.ledger, input.bootstrap.linkId, input.ownEventIds)) {
    stream.legal.push(tap.key);
    return;
  }
  const floor = newestStamp(standing(envelopes));
  const payload = restamp(tap.type, tap.payload, floor, phaseOf(match, envelopes));
  const envelope = queuedEnvelopeOf(
    match.engine.fixtureId,
    { ...tap, payload },
    nextSeq(envelopes),
  );
  if (!mayAppend(match.engine, envelopes, envelope)) return;
  stream.legal.push(tap.key);
  envelopes.push(envelope);
  stream.entries.push({ envelope, own: true, sending: true });
  stream.tapped.set(envelope.id, tap.payload);
}

const nextSeq = (envelopes: readonly EventEnvelope[]) =>
  (envelopes[envelopes.length - 1]?.seq ?? 0) + 1;

/** The events still in the match: no void, and nothing a void takes back. */
function standing(envelopes: readonly EventEnvelope[]): readonly EventEnvelope[] {
  const voided = voidedIn(envelopes);
  return envelopes.filter((envelope) => envelope.voids === undefined && !voided.has(envelope.id));
}

/** The engine's phase after `envelopes`; before the start for a stream it will not replay (the fold then says so). */
function phaseOf(match: FootballMatch, envelopes: readonly EventEnvelope[]): string {
  const { cfg, lineups } = match.engine;
  try {
    return foldMatch(football, cfg, lineups, envelopes).phase;
  } catch (error) {
    if (EngineError.is(error)) return 'pre';
    throw error;
  }
}

/** Whether the server would append `next` after `before`: the web's refusal of an undo twice, then the engine's. */
const mayAppend = (
  engine: FootballEngineMatch,
  before: readonly EventEnvelope[],
  next: EventEnvelope,
): boolean => !voidsAgain(before, next) && footballRefusalOf(engine, [...before, next]) === null;

// ---------------------------------------------------------------------------------------------------------------
// The fold, and what it says of each event
// ---------------------------------------------------------------------------------------------------------------

/** The read path's tolerant fold, with each standing event's facts; null for a stream the engine will not replay. */
function foldOf(
  engine: FootballEngineMatch,
  envelopes: readonly EventEnvelope[],
): FootballFolded | null {
  const facts = new Map<string, FootballFacts>();
  let before = 'pre';
  try {
    const { state } = foldMatchWithStoppage(football, engine.cfg, engine.lineups, envelopes, {
      onFolded: (after, event) => {
        facts.set(event.id, factsOf(before, after, event.type));
        before = after.phase;
      },
    });
    return { state, facts };
  } catch (error) {
    if (EngineError.is(error)) return null;
    throw error;
  }
}

/**
 * An event's facts: the period it was recorded in is the phase before it (a period marker belongs to the period it ends),
 * but the start's is the first half it opens, and a card before the start is the first half's too.
 */
const factsOf = (before: string, after: Readonly<FootballState>, type: string): FootballFacts => ({
  period: type === 'core.start' || before === 'pre' ? 'H1' : before,
  after: { first: after.goals.home, second: after.goals.away },
});

/**
 * What each event the pad has words for did, by envelope id: the standing ones from the fold, and each one a void takes
 * back from a fold of the stream up to it, so its row keeps the score it left.
 */
function recordedOf(
  match: FootballMatch,
  envelopes: readonly EventEnvelope[],
  facts: ReadonlyMap<string, FootballFacts>,
): ReadonlyMap<string, FootballRecorded> {
  const voided = voidedIn(envelopes);
  const recorded = new Map<string, FootballRecorded>();
  envelopes.forEach((envelope, at) => {
    const known =
      facts.get(envelope.id) ??
      (voided.has(envelope.id)
        ? foldOf(match.engine, envelopes.slice(0, at + 1))?.facts.get(envelope.id)
        : undefined);
    const did = doneOf(match, envelope);
    if (known !== undefined && did !== null) recorded.set(envelope.id, { did, facts: known });
  });
  return recorded;
}

/**
 * The clock corrections, by envelope id (the controller's fix-round ruling I1): every screen says a clock event that moved
 * the time and nothing else as a correction, whoever sent it (`correctionsIn`). Undo takes one back alone, as any tap.
 */
function correctionIdsOf(
  stream: FootballStream,
  anchors: readonly AnchorEvent[],
): ReadonlySet<string> {
  return new Set([...correctionsIn(anchors)].map((at) => stream.entries[at]!.envelope.id));
}

/** What each event did, a correction's clock event said as one. */
const withCorrections = (
  recorded: ReadonlyMap<string, FootballRecorded>,
  corrections: ReadonlySet<string>,
): ReadonlyMap<string, FootballRecorded> =>
  new Map(
    [...recorded].map(([id, event]) =>
      corrections.has(id) && event.did.kind === 'clock'
        ? [id, { ...event, did: { kind: 'clockCorrect', at: event.did.at } }]
        : [id, event],
    ),
  );

/** A payload's field, or undefined for a payload that is not an object. */
const field = (payload: unknown, name: string): unknown =>
  isRecord(payload) ? payload[name] : undefined;

/** What an event did, in the pad's words, or null for one it has none for (a void, the organiser's). */
function doneOf(match: FootballMatch, envelope: EventEnvelope): FootballDone | null {
  const { type, payload } = envelope;
  if (type === 'core.start') return { kind: 'start' };
  if (type === 'football.clock') return clockDone(payload);
  if (type === 'football.period') return periodDone(payload);
  const side = sideOfEntrant(match, field(payload, 'by'));
  if (side === null) return null;
  const said = SAID[type];
  return said === undefined ? null : said(match, side, payload);
}

const clockDone = (payload: unknown): FootballDone | null => {
  const running = field(payload, 'running');
  return typeof running === 'boolean' ? { kind: 'clock', running, at: gameTimeOf(payload) } : null;
};

const periodDone = (payload: unknown): FootballDone | null => {
  const marker = field(payload, 'phase');
  return typeof marker === 'string' ? { kind: 'period', marker, at: gameTimeOf(payload) } : null;
};

type Said = (match: FootballMatch, side: PadSide, payload: unknown) => FootballDone | null;

/** What each of a team's events did: a goal is credited to the other team when it is an own goal. */
const SAID: Readonly<Record<string, Said>> = {
  'football.goal': (match, side, payload) => ({
    kind: 'goal',
    side: field(payload, 'ownGoal') === true ? otherSide(side) : side,
    scorer: playerOf(match, side, field(payload, 'scorer')),
    ownGoal: field(payload, 'ownGoal') === true,
    penalty: field(payload, 'penalty') === true,
    at: gameTimeOf(payload),
  }),
  'football.card': (match, side, payload) => ({
    kind: 'card',
    side,
    color: String(field(payload, 'color')),
    person: playerOf(match, side, field(payload, 'person')),
    at: gameTimeOf(payload),
  }),
  'football.sub': subDone,
  'football.penalty': (match, side, payload) => ({
    kind: 'penaltyMiss',
    side,
    taker: playerOf(match, side, field(payload, 'taker')),
    outcome: String(field(payload, 'outcome')),
    at: gameTimeOf(payload),
  }),
  'football.sinbin.start': (match, side, payload) => binDone('sinBin', match, side, payload),
  'football.sinbin.end': (match, side, payload) => binDone('sinBinEnd', match, side, payload),
  'football.shot': (match, side, payload) => ({
    kind: 'shot',
    side,
    taker: playerOf(match, side, field(payload, 'taker')),
    outcome: String(field(payload, 'outcome')),
    at: gameTimeOf(payload),
  }),
  'football.shootout.kick': (match, side, payload) => ({
    kind: 'kick',
    side,
    person: playerOf(match, side, field(payload, 'person')),
    scored: field(payload, 'scored') === true,
  }),
};

/** A substitution names both players; one this match does not know has no words (a sheet the bootstrap left out). */
function subDone(match: FootballMatch, side: PadSide, payload: unknown): FootballDone | null {
  const off = playerOf(match, side, field(payload, 'off'));
  const on = playerOf(match, side, field(payload, 'on'));
  return off === null || on === null
    ? null
    : { kind: 'sub', side, off, on, at: gameTimeOf(payload) };
}

const binDone = (
  kind: 'sinBin' | 'sinBinEnd',
  match: FootballMatch,
  side: PadSide,
  payload: unknown,
): FootballDone => ({
  kind,
  side,
  person: playerOf(match, side, field(payload, 'person')),
  at: gameTimeOf(payload),
});

function sideOfEntrant(match: FootballMatch, entrantId: unknown): PadSide | null {
  if (entrantId === match.seats.first.entrantId) return 'first';
  return entrantId === match.seats.second.entrantId ? 'second' : null;
}

const playerOf = (match: FootballMatch, side: PadSide, personId: unknown): FootballPlayer | null =>
  typeof personId === 'string' ? (match.players[side].get(personId) ?? null) : null;

// ---------------------------------------------------------------------------------------------------------------
// The display
// ---------------------------------------------------------------------------------------------------------------

/** What the fold read of the stream, for the display: the engine's state, what each event did, and the clock's events. */
type Read = {
  readonly stream: FootballStream;
  readonly folded: FootballFolded;
  readonly recorded: ReadonlyMap<string, FootballRecorded>;
  readonly anchors: readonly AnchorEvent[];
};

function displayOf(match: FootballMatch, input: SportFoldInput, read: Read): FootballDisplay {
  const { stream, folded, recorded } = read;
  const { state } = folded;
  const sides = { first: sideOf(match, state, 'first'), second: sideOf(match, state, 'second') };
  return {
    phase: padPhaseOf(state.phase),
    enginePhase: state.phase,
    cfg: match.engine.cfg,
    context: match.context,
    sides,
    goals: { first: state.goals.home, second: state.goals.away },
    shootout: shootoutOf(state),
    clock: clockOf(read.anchors, stream, folded),
    marker: markerOf(state),
    subsLeft: { first: subsLeftOf(state, sides.first), second: subsLeftOf(state, sides.second) },
    lastTap: lastTapOf(stream.envelopes, recorded, (did) => (did.kind === 'start' ? null : did)),
    undoable: undoableOf(input, stream),
    kickedOff: kickedOffOf(stream.envelopes),
    ledgerTip: input.ledger.reduce((tip, event) => Math.max(tip, event.seq), 0),
  };
}

const PAD_PHASE: Readonly<Record<string, FootballPadPhase>> = {
  pre: 'notStarted',
  SHOOTOUT: 'shootout',
  done: 'decided',
  final: 'decided',
  abandoned: 'decided',
};

/** Before the start, the kicks, over; every other phase is a period in play. */
const padPhaseOf = (phase: string): FootballPadPhase => PAD_PHASE[phase] ?? 'play';

/** One team, as its column draws it and its sheets list it. */
function sideOf(match: FootballMatch, state: FootballState, side: PadSide): FootballSide {
  const squad = state.squads[ENGINE_SIDE[side]];
  const people = (ids: readonly string[]) => ids.flatMap((id) => playerOf(match, side, id) ?? []);
  const sentOff = new Set(squad.sentOff);
  const cards = state.cards.filter((card) => card.side === ENGINE_SIDE[side]);
  return {
    entrantId: match.seats[side].entrantId,
    name: match.seats[side].name,
    sheet: match.sheets[side],
    onPitch: people(squad.onPitch),
    bench: people(squad.bench),
    offeredOn: people(squad.bench.filter((id) => !sentOff.has(id))),
    cardable: people(cardableOf(squad)),
    yellowed: yellowedOf(cards),
    sentOff: squad.sentOff,
    sinBin: (squad.sinBin ?? []).map((entry) => ({
      person: playerOf(match, side, entry.person),
      expiresAt: entry.expiresAt ?? null,
    })),
    cards: cardCountOf(cards),
  };
}

type Squad = FootballState['squads'][keyof FootballState['squads']];
type Card = FootballState['cards'][number];

/** Everyone a card may name: on the pitch, on the bench, off after a sub, in the bin, the non-players; none sent off. */
function cardableOf(squad: Squad): readonly string[] {
  const sentOff = new Set(squad.sentOff);
  const binned = (squad.sinBin ?? []).flatMap((entry) => entry.person ?? []);
  const named = [
    ...squad.onPitch,
    ...squad.bench,
    ...squad.offUsed,
    ...binned,
    ...(squad.nonPlayers ?? []),
  ];
  return [...new Set(named)].filter((id) => !sentOff.has(id));
}

/** The people a team's yellow cards name, in the order they were shown. */
const yellowedOf = (cards: readonly Card[]): readonly string[] =>
  cards.flatMap((card) =>
    card.color === 'yellow' && card.person !== undefined ? [card.person] : [],
  );

/** A team's cards by colour: a second yellow's red is a red. */
const cardCountOf = (cards: readonly Card[]): FootballSide['cards'] => ({
  yellow: cards.filter((card) => card.color === 'yellow').length,
  red: cards.filter((card) => card.color !== 'yellow').length,
});

/** The shootout, by seat: the kicks in order, whose kick is next in the engine's order, and the kicks scored. */
function shootoutOf(state: FootballState): FootballShootout | null {
  if (state.shootout === null) return null;
  const { kicks } = state.shootout;
  const next = footballNextKicker(kicks);
  const scored = shootoutTally(kicks);
  return {
    kicks: kicks.map((kick) => ({ side: seatOf(kick.side), scored: kick.scored })),
    next: next === null ? null : seatOf(next),
    scored: { first: scored.home, second: scored.away },
  };
}

/** The marker End of period records now: the one the engine takes in this phase, if any. */
function markerOf(state: FootballState): FootballMarker | null {
  const marker = footballPadRules.legalPeriodMarkers(state.phase, state.cfg)[0];
  return MARKERS.find((known) => known === marker) ?? null;
}

const MARKERS: readonly FootballMarker[] = ['HT', 'FT', 'QT', '3QT', 'ET_HT', 'ET_FT'];

/**
 * Whether a team may still substitute, in the engine's judgement (design §6.3: the builder reads the engine rather than
 * counting): one more change, the first on the pitch for the first offered on, stamped as the pad would stamp it
 * (`subStamp`, so a change at the last window's stoppage joins it), applied strictly. Only the cap's refusals say no:
 * the window cap (`SUB_WINDOW_EXCEEDED`) and the substitution cap (`sub-cap-reached`). Nobody to bring on is no too.
 */
function subsLeftOf(state: FootballState, side: FootballSide): boolean {
  const off = side.onPitch[0];
  const on = side.offeredOn[0];
  if (off === undefined || on === undefined) return false;
  try {
    football.apply(state, candidateSub(state, side.entrantId, off.personId, on.personId), {
      strict: true,
    });
    return true;
  } catch (error) {
    if (!EngineError.is(error)) throw error;
    return (
      error.code !== 'SUB_WINDOW_EXCEEDED' && field(error.data, 'reason') !== 'sub-cap-reached'
    );
  }
}

/** The change `subsLeftOf` asks the engine about: stamped as the pad stamps a sub, after every event the ledger holds. */
function candidateSub(state: FootballState, by: string, off: string, on: string): FootballEnvelope {
  const stamp = subStamp(state.phase, state.asOf ?? null);
  return {
    id: 'candidate-sub',
    fixtureId: 'candidate',
    seq: Number.MAX_SAFE_INTEGER,
    type: 'football.sub',
    payload: { by, off, on, ...(stamp === null ? {} : { at: stamp }) },
    recordedAt: new Date(0).toISOString(),
    recordedBy: null,
  };
}

/** An event as football's `apply` takes it, its payload one of the module's own. */
type FootballEnvelope = Parameters<typeof football.apply>[1];

/** The shared clock (design §7.2): its anchor in the current phase, the engine's `asOf` and the break word's period. */
function clockOf(
  anchors: readonly AnchorEvent[],
  stream: FootballStream,
  folded: FootballFolded,
): FootballDisplay['clock'] {
  return {
    anchor: anchorOf(anchors, folded.state.phase),
    started: periodStarted(anchors, folded.state.phase),
    asOf: folded.state.asOf ?? null,
    justEnded: justEndedOf(stream.envelopes, voidedIn(stream.envelopes), folded.facts),
  };
}

/** The stream's events as the clock reads them, in order. */
function anchorEventsOf(input: SportFoldInput, stream: FootballStream): readonly AnchorEvent[] {
  const voided = voidedIn(stream.envelopes);
  return stream.entries.map((entry, i) => anchorEventOf(input, entry, i, voided, stream.tapped));
}

/**
 * One event as the anchor reads it: the ledger's at its `recorded_at`, on the clock `anchorBase` names; a queued tap's on
 * the phone's, with its payload as tapped (`tapped`).
 */
function anchorEventOf(
  input: SportFoldInput,
  entry: LedgerEntry,
  index: number,
  voided: ReadonlySet<string>,
  tapped: ReadonlyMap<string, unknown>,
): AnchorEvent {
  const { envelope } = entry;
  const event = entry.sending ? undefined : input.ledger[index];
  return {
    type: envelope.type,
    payload: tapped.get(envelope.id) ?? envelope.payload,
    atMs: Date.parse(envelope.recordedAt),
    base: event === undefined ? 'device' : anchorBase(event, input.ownEventIds),
    standing: !voided.has(envelope.id),
  };
}

/** The period the last standing marker ended, while no clock event stands after it: the break between periods. */
function justEndedOf(
  envelopes: readonly EventEnvelope[],
  voided: ReadonlySet<string>,
  facts: ReadonlyMap<string, FootballFacts>,
): string | null {
  const live = envelopes.filter((envelope) => !voided.has(envelope.id)).reverse();
  const since = live.findIndex((envelope) => envelope.type === 'football.period');
  const ended = live[since];
  if (ended === undefined) return null;
  const restarted = live.slice(0, since).some((envelope) => envelope.type === 'football.clock');
  return restarted ? null : (facts.get(ended.id)?.period ?? null);
}

/** Whether this phone's Undo has something to take back: its latest standing event, the legal queued taps included. */
function undoableOf(input: SportFoldInput, stream: FootballStream): boolean {
  const legalTaps = input.queued.filter((tap) => stream.legal.includes(tap.key));
  return undoTarget(input.ledger, legalTaps, input.ownEventIds, () => true).kind !== 'blocked';
}

/** Anything stands after the start. */
function kickedOffOf(envelopes: readonly EventEnvelope[]): boolean {
  const live = standing(envelopes);
  const started = live.findIndex((envelope) => envelope.type === 'core.start');
  return started >= 0 && started < live.length - 1;
}
