import type { CallRefused, Candidate } from '@/domain/matchday/callWire';

/**
 * What a refused call says (S4 Match Day design §7a), pure: the dictionary key and its fills for each refusal, or
 * `leave` for the words that end the code and keep its own handling (the day's, as an approval's refusal has it). The
 * screens only draw it. Every key is the dictionary's own (`src/i18n/en.json`).
 */
export type LineKey =
  | 'matchday.call.noPower'
  | 'matchday.call.courtOutOfScope'
  | 'matchday.outOfScope'
  | 'matchday.call.started'
  | 'matchday.call.moved'
  | 'matchday.call.courtBusy'
  | 'matchday.call.notReady'
  | 'matchday.call.frozen'
  | 'matchday.call.notCodeCall'
  | 'matchday.call.notCandidate'
  | 'matchday.call.busy'
  | 'matchday.call.busyNoCourt';

export type Line = { readonly key: LineKey; readonly vars?: Readonly<Record<string, string>> };
export type Meaning = Line | 'leave';

/** Which call route was refused: only the court's own read is about the court, the others about a match. */
export type Route = 'candidates' | 'preview' | 'call' | 'undo';

/** What the refusal says, in the court `court` that the sheet is about. */
export function refusalMeaning(refused: CallRefused, route: Route, court: string): Meaning {
  switch (refused.code) {
    case 'MD_UNKNOWN':
    case 'MD_WITHDRAWN':
    case 'MD_ENDED':
    case 'MD_NOT_OPEN':
      return 'leave';
    case 'MD_NO_CALL':
      return { key: 'matchday.call.noPower' };
    case 'MD_OUT_OF_SCOPE':
      return {
        key: route === 'candidates' ? 'matchday.call.courtOutOfScope' : 'matchday.outOfScope',
      };
    case 'MD_CALL_REFUSED':
      return desk(refused, court, route);
  }
}

function desk(
  refused: Extract<CallRefused, { code: 'MD_CALL_REFUSED' }>,
  court: string,
  route: Route,
): Line {
  const named = refused.courtName ?? court;
  // Undo cannot be refused for a court or a player (the contract): if it ever is, the match is not where it was.
  if (route === 'undo' && ['notCandidateCourt', 'courtBusy', 'playerBusy'].includes(refused.reason))
    return { key: 'matchday.call.moved' };
  switch (refused.reason) {
    case 'notCandidateCourt':
      return { key: 'matchday.call.notCandidate', vars: { court: named } };
    case 'courtBusy':
      return { key: 'matchday.call.courtBusy', vars: { court: named } };
    case 'playerBusy':
      return busy(refused.personName, refused.courtName);
    case 'started':
      return { key: 'matchday.call.started' };
    case 'notReady':
      return { key: 'matchday.call.notReady' };
    case 'notCalled':
      return { key: 'matchday.call.moved' };
    case 'frozen':
      return { key: 'matchday.call.frozen' };
    case 'notCodeCall':
      return { key: 'matchday.call.notCodeCall' };
    case 'unknown':
      return { key: 'matchday.call.moved' };
  }
}

/** "{name} is playing on {court}", or without the court when the other match has none; none named is "moved". */
function busy(name: string | null, court: string | null): Line {
  if (name === null) return { key: 'matchday.call.moved' };
  if (court === null) return { key: 'matchday.call.busyNoCourt', vars: { name } };
  return { key: 'matchday.call.busy', vars: { name, court } };
}

/** The dimmed reason under a blocked candidate: the same words the refusal would have said. */
export function blockedLine(candidate: Candidate): Line | null {
  const { blocked } = candidate;
  return blocked === null ? null : busy(blocked.personName, blocked.courtName);
}

/** Where a candidate is now: its court's queue, or not on a court yet. */
export type Place =
  | { readonly kind: 'nextOn'; readonly court: string }
  | { readonly kind: 'calledTo'; readonly court: string }
  | { readonly kind: 'noCourt' };

/**
 * `thisCourt` waits on the court the sheet is about, `otherCourt` on another (queued next there, or `called` onto it and
 * not started: calling it here moves it); none on no court.
 */
export function placeOf(candidate: Candidate, court: string): Place {
  if (candidate.source === 'noCourt') return { kind: 'noCourt' };
  const where = candidate.source === 'thisCourt' ? court : (candidate.fromCourtName ?? court);
  return { kind: candidate.called ? 'calledTo' : 'nextOn', court: where };
}
