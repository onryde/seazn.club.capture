import { gameTimeOf, type GameTime } from '@seazn/engine/core';
import { footballPadRules } from '@seazn/engine/pad';
import {
  newestStamp,
  overtaken,
  restamp,
  stampFor,
  subStampFor,
  subStoppageOf,
  WITHDRAWN_EVENT,
} from '@/domain/scoring/footballClock';
import { footballOptions } from '@/domain/scoring/footballEngine';
import { footballLedgerPhase } from '@/domain/scoring/footballFold';
import {
  otherSide,
  type FootballDisplay,
  type FootballPlayer,
  type FootballTap,
  type FootballTypes,
} from '@/domain/scoring/footballTypes';
import type { QueuedEvent } from '@/domain/scoring/queue';
import {
  withdrawal,
  type SendWithdrawal,
  type SportEvent,
  type SportEventContext,
  type SportSendContext,
} from '@/domain/scoring/scoringSport';
import type { LedgerEvent } from '@/domain/scoring/wire';

/**
 * Football's taps as the events the server records (S2-5 design §7.3, §8; plan P Task 7). A tap names what the scorer
 * chose in the column it was made in; the event is made against the display the scorer saw: stamped with the reading the
 * button captured, in the fold's phase, never below the fold's `asOf` in that period (`stampFor`); a substitution joins the
 * stoppage it was made at, or keeps its own reading (`subStampFor`, ruling 154). A tap that names what the match does not have (a bench scorer, a second yellow with no
 * first, a colour or a reason the engine does not list, a phase the event is not taken in) makes no event at all.
 *
 * Optional persons and reasons are left out of the payload, never sent as null: the engine's schemas are strict. The
 * engine's `minute` and `addedMinutes` are never sent (the fold never reads them), nor anything only an organiser may
 * record.
 */
export function footballEventFor(
  tap: FootballTap,
  ctx: SportEventContext<FootballTypes>,
): SportEvent | null {
  const event = eventOf(tap, ctx.display);
  return event !== null && takenNow(event.type, ctx.display) ? event : null;
}

/** The phase gate the engine applies (`eventAllowedInPhase`), for its own event types; the start is the fold's to judge. */
const takenNow = (type: string, display: FootballDisplay): boolean =>
  !type.startsWith('football.') ||
  footballPadRules.eventAllowedInPhase(type, display.enginePhase, display.cfg);

function eventOf(tap: FootballTap, display: FootballDisplay): SportEvent | null {
  switch (tap.kind) {
    case 'start':
      return { type: 'core.start', payload: {} };
    case 'clock':
      return clockEvent(tap, display);
    case 'goal':
      return goalEvent(tap, display);
    case 'ownGoal':
      return ownGoalEvent(tap, display);
    case 'card':
      return cardEvent(tap, display);
    case 'sub':
      return subEvent(tap, display);
    case 'period':
      return periodEvent(tap, display);
    default:
      return teamEvent(tap, display);
  }
}

type Tap<K extends FootballTap['kind']> = Extract<FootballTap, { kind: K }>;

/** The fields that were given: an absent person or reason is left out, never null. */
const given = (fields: Readonly<Record<string, unknown>>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== null && value !== undefined),
  );

/** A tap's `at`: its captured reading, in the fold's phase, raised to the fold's `asOf` in that period. */
const atOf = (stamp: GameTime | null, display: FootballDisplay): GameTime | null =>
  stampFor(stamp, display.enginePhase, display.clock.asOf);

/** Whether `personId` is "nobody named" or one of `players`. */
const among = (players: readonly FootballPlayer[], personId: string | null): boolean =>
  personId === null || players.some((player) => player.personId === personId);

/**
 * Start or Pause, stamped in the fold's phase at the reading, never below a same-period `asOf`. A Start that waits in
 * the queue is sent as it was tapped (design §7.2): one accepted late is followed by a resync tap (`needsResync`). It
 * carries the ledger's tip it was made over as its `base`, so its send can tell another screen's later clock event from
 * one the scorer saw (`overtaken`).
 */
function clockEvent(tap: Tap<'clock'>, display: FootballDisplay): SportEvent {
  const { enginePhase, clock } = display;
  const floor = clock.asOf?.period === enginePhase ? clock.asOf.elapsed : 0;
  const at = { period: enginePhase, elapsed: Math.max(tap.elapsed, floor) };
  return { type: 'football.clock', payload: { running: tap.running, at }, base: display.ledgerTip };
}

/** A goal for the column's team: the scorer and the assist on its pitch, never the same player; a penalty has no assist. */
function goalEvent(tap: Tap<'goal'>, display: FootballDisplay): SportEvent | null {
  const team = display.sides[tap.side];
  const assist = tap.penalty ? null : tap.assist;
  if (!among(team.onPitch, tap.scorer) || !among(team.onPitch, assist)) return null;
  if (assist !== null && assist === tap.scorer) return null;
  const payload = given({
    by: team.entrantId,
    scorer: tap.scorer,
    assist,
    penalty: tap.penalty ? true : null,
    at: atOf(tap.stamp, display),
  });
  return { type: 'football.goal', payload };
}

/**
 * An own goal in the column's favour: in the engine `by` is the side whose player put it in, the OTHER team, and the
 * goal counts for the column's (design §6.3; staging agreed, §4). The scorer is on that other team's pitch.
 */
function ownGoalEvent(tap: Tap<'ownGoal'>, display: FootballDisplay): SportEvent | null {
  const striking = display.sides[otherSide(tap.side)];
  if (!among(striking.onPitch, tap.scorer)) return null;
  const payload = given({
    by: striking.entrantId,
    ownGoal: true,
    scorer: tap.scorer,
    at: atOf(tap.stamp, display),
  });
  return { type: 'football.goal', payload };
}

/** A card: a colour and a reason the engine lists; a person who may be booked, and a second yellow only after a yellow. */
function cardEvent(tap: Tap<'card'>, display: FootballDisplay): SportEvent | null {
  const team = display.sides[tap.side];
  if (!footballPadRules.cardColors.includes(tap.color) || !reasonListed(tap.reason)) return null;
  if (tap.person !== null && !bookable(team.cardable, team.yellowed, tap.person, tap.color))
    return null;
  const payload = given({
    by: team.entrantId,
    person: tap.person,
    color: tap.color,
    reason: tap.reason,
    at: atOf(tap.stamp, display),
  });
  return { type: 'football.card', payload };
}

const reasonListed = (reason: string | null): boolean =>
  reason === null || footballPadRules.cardReasons.includes(reason);

/** Whether the engine takes `color` for `person`: one who may be booked; a second yellow only after a first, never two. */
function bookable(
  cardable: readonly FootballPlayer[],
  yellowed: readonly string[],
  person: string,
  color: string,
): boolean {
  if (!among(cardable, person)) return false;
  if (color === 'second_yellow') return yellowed.includes(person);
  return color !== 'yellow' || !yellowed.includes(person);
}

/**
 * A substitution: a player on the pitch off, one offered on on; stamped with the stoppage's stamp when it joins one, else
 * with the reading when Sub was pressed (`subStampFor`, ruling 154).
 */
function subEvent(tap: Tap<'sub'>, display: FootballDisplay): SportEvent | null {
  const team = display.sides[tap.side];
  const known = (players: readonly FootballPlayer[], id: string) =>
    players.some((p) => p.personId === id);
  if (!known(team.onPitch, tap.off) || !known(team.offeredOn, tap.on)) return null;
  const at = subStampFor(
    tap.stamp,
    display.enginePhase,
    display.clock.asOf,
    display.clock.stoppage,
  );
  if (tap.concussion === true) return replacementEvent(team.entrantId, tap, at);
  const payload = given({ by: team.entrantId, off: tap.off, on: tap.on, at });
  return { type: 'football.sub', payload };
}

/**
 * A concussion sub (ruling 155): the engine's `core.lineup.replacement` naming the concussion exemption, which it holds
 * outside the substitution cap and its windows (`lineupPolicy`, `football.js`). `on` is the kernel's slot: the bench
 * row's `slot` and `orderNo` are structural filler there, as in the engine's own lift of a `football.sub`
 * (`subAsLineup`): it matches the player by `personId` alone.
 */
function replacementEvent(side: string, tap: Tap<'sub'>, at: GameTime | null): SportEvent {
  const on = { personId: tap.on, slot: 'bench', orderNo: 1 };
  const payload = given({ side, off: tap.off, on, exemption: CONCUSSION, at });
  return { type: 'core.lineup.replacement', payload };
}

/** The engine's key for the IFAB concussion exemption (`lineupPolicy`'s `exemptions.concussion`). */
const CONCUSSION = 'concussion';

/** End of period: the marker the engine takes now, or nothing when it takes none. */
function periodEvent(tap: Tap<'period'>, display: FootballDisplay): SportEvent | null {
  if (display.marker === null) return null;
  return {
    type: 'football.period',
    payload: given({ phase: display.marker, at: atOf(tap.stamp, display) }),
  };
}

type TeamTap = Tap<'penaltyMiss' | 'sinBin' | 'sinBinEnd' | 'shot' | 'kick'>;

/** The More sheet's events and the shootout's kicks: each for the column's team. */
function teamEvent(tap: TeamTap, display: FootballDisplay): SportEvent | null {
  switch (tap.kind) {
    case 'penaltyMiss':
      return penaltyEvent(tap, display);
    case 'sinBin':
      return sinBinEvent(tap, display);
    case 'sinBinEnd':
      return sinBinEndEvent(tap, display);
    case 'shot':
      return shotEvent(tap, display);
    case 'kick':
      return kickEvent(tap, display);
  }
}

/** A penalty that did not go in: the taker on his team's pitch, the goalkeeper on the other's, an outcome the engine lists. */
function penaltyEvent(tap: Tap<'penaltyMiss'>, display: FootballDisplay): SportEvent | null {
  const team = display.sides[tap.side];
  const keepers = display.sides[otherSide(tap.side)].onPitch;
  if (!footballPadRules.penaltyOutcomes.includes(tap.outcome)) return null;
  if (!among(team.onPitch, tap.taker) || !among(keepers, tap.goalkeeper)) return null;
  const payload = given({
    by: team.entrantId,
    taker: tap.taker,
    goalkeeper: tap.goalkeeper,
    outcome: tap.outcome,
    at: atOf(tap.stamp, display),
  });
  return { type: 'football.penalty', payload };
}

/** A sin-bin: a player on the pitch, a reason the engine lists. */
function sinBinEvent(tap: Tap<'sinBin'>, display: FootballDisplay): SportEvent | null {
  const team = display.sides[tap.side];
  if (!among(team.onPitch, tap.person) || !reasonListed(tap.reason)) return null;
  const payload = given({
    by: team.entrantId,
    person: tap.person,
    reason: tap.reason,
    at: atOf(tap.stamp, display),
  });
  return { type: 'football.sinbin.start', payload };
}

/** Back from the sin-bin: a player who is in it. */
function sinBinEndEvent(tap: Tap<'sinBinEnd'>, display: FootballDisplay): SportEvent | null {
  const team = display.sides[tap.side];
  const binned = team.sinBin.flatMap((entry) => (entry.person === null ? [] : [entry.person]));
  if (!among(binned, tap.person)) return null;
  const payload = given({ by: team.entrantId, person: tap.person, at: atOf(tap.stamp, display) });
  return { type: 'football.sinbin.end', payload };
}

/** A shot: the taker on his team's pitch, an outcome the engine's own schema lists. */
function shotEvent(tap: Tap<'shot'>, display: FootballDisplay): SportEvent | null {
  const team = display.sides[tap.side];
  if (!footballOptions('football.shot', 'outcome').includes(tap.outcome)) return null;
  if (!among(team.onPitch, tap.taker)) return null;
  const payload = given({
    by: team.entrantId,
    taker: tap.taker,
    outcome: tap.outcome,
    at: atOf(tap.stamp, display),
  });
  return { type: 'football.shot', payload };
}

/** A shootout kick: a player on his team's pitch, or nobody named. No stamp: the kicks are not played on the clock. */
function kickEvent(tap: Tap<'kick'>, display: FootballDisplay): SportEvent | null {
  const team = display.sides[tap.side];
  if (!among(team.onPitch, tap.person)) return null;
  const payload = given({ by: team.entrantId, person: tap.person, scored: tap.scored });
  return { type: 'football.shootout.kick', payload };
}

// ---------------------------------------------------------------------------------------------------------------
// At send
// ---------------------------------------------------------------------------------------------------------------

/**
 * The payload a queued tap is sent with now (design §7.2, §7.3; ruling 3). A tap the ledger holds a copy of goes as it
 * first went (the server matches a resend by its key). Otherwise its stamp is judged against the ledger as it stands: in
 * the newest stamp's period and below it, raised to it; in a period the ledger's phase has left, dropped; a substitution
 * joins the stoppage the ledger now ends on, or keeps its own stamp (ruling 154). Nothing is added for the time a tap waited in the queue (the controller's ruling,
 * 2026-11-08): the payload is a function of the tap and the ledger alone, so two sends over one ledger send the same
 * payload and the runtime still knows the server's copy of a tap whose answer was lost.
 *
 * The ledger's phase is folded from the bootstrap the match holds; with none (or a ledger that will not fold), the newest
 * stamp's period stands for it. A clock tap another screen overtook is not sent at all: it is withdrawn (`overtaken`;
 * the controller's ruling, final review, 2026-11-08). With no bootstrap there is no link to tell another screen by, and
 * the tap is restamped as any other.
 */
export function footballPayloadForSend(
  queued: QueuedEvent,
  ledger: readonly LedgerEvent[],
  copied: boolean,
  send: SportSendContext,
): unknown {
  if (copied) return queued.payload;
  if (
    send.bootstrap !== null &&
    overtaken(queued, ledger, send.bootstrap.linkId, send.ownEventIds)
  ) {
    return withdrawnOf(queued);
  }
  const standing = standingOf(ledger);
  const floor = newestStamp(standing);
  const folded = send.bootstrap === null ? null : footballLedgerPhase(send.bootstrap, ledger);
  const phase = folded ?? floor?.period ?? 'pre';
  return restamp(queued.type, queued.payload, floor, phase, subStoppageOf(standing, phase));
}

/** An overtaken clock tap's withdrawal: the record says the period it was tapped in (`overtaken` found one). */
const withdrawnOf = (queued: QueuedEvent): SendWithdrawal =>
  withdrawal({
    event: WITHDRAWN_EVENT,
    fields: { phase: gameTimeOf(queued.payload)?.period ?? '' },
  });

/** The ledger's events still in the match: no void, and nothing a void takes back. */
function standingOf(ledger: readonly LedgerEvent[]): readonly LedgerEvent[] {
  const voided = new Set(ledger.flatMap((event) => (event.voids === null ? [] : [event.voids])));
  return ledger.filter((event) => event.voids === null && !voided.has(event.id));
}
