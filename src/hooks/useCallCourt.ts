import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { refusalMeaning, type Line, type Route } from '@/domain/matchday/callCopy';
import type { Called, CallPreview, Candidate, Warning } from '@/domain/matchday/callWire';
import { heldCode, type Held } from '@/hooks/useApproval';
import { leaveDay } from '@/hooks/useMatchDay';
import { refusalVerdict } from '@/hooks/useMatchDayHome';
import { usePorts, type Ports } from '@/hooks/usePorts';
import type { CallAnswer } from '@/services/matchDayPort';

/**
 * `list`: choosing a match; `preview`: the server's knock-on for the one picked, and the hold. `loading`: asked and not
 * answered; `ready`: answered; `offline`: no answer the phone can act on, and Try again asks again; `refused`: the
 * server will not take this code's call (no power, out of scope), said in `notice`.
 */
export type CallStep = 'list' | 'preview';
export type CallLoad = 'loading' | 'ready' | 'offline' | 'refused';

export type CallView = {
  readonly step: CallStep;
  readonly list: CallLoad;
  readonly candidates: readonly Candidate[];
  readonly picked: Candidate | null;
  readonly preview: Exclude<CallLoad, 'refused'>;
  readonly warnings: readonly Warning[];
  /** The call is out: one at a time, and the hold waits. */
  readonly calling: boolean;
  /** The last refusal, said on the sheet in the server's own reason, until the next ask. */
  readonly notice: Line | null;
  /** A candidate chosen: its preview is asked. A blocked one, a second tap and a tap while one is out do nothing. */
  readonly pick: (candidate: Candidate) => void;
  /** The preview back to the list. */
  readonly choose: () => void;
  /** Reads the candidates again (the list's Try again). */
  readonly retry: () => void;
  /** Reads the preview again (the preview's Try again). */
  readonly retryPreview: () => void;
  /** The 3 s hold's action: one call at a time, and only from a ready preview. */
  readonly call: () => void;
};

/** What the sheet needs of the list beneath: read the day again, and close the sheet. */
export type CallSink = { readonly refresh: () => void; readonly close: () => void };

type Shown = Omit<CallView, 'pick' | 'choose' | 'retry' | 'retryPreview' | 'call'>;
type Flags = { reading: boolean; previewing: boolean; calling: boolean };

const FIRST: Shown = {
  step: 'list',
  list: 'loading',
  candidates: [],
  picked: null,
  preview: 'loading',
  warnings: [],
  calling: false,
  notice: null,
};

type Deps = {
  readonly ports: Ports;
  readonly courtId: string;
  readonly court: string;
  readonly flags: { readonly current: Flags };
  readonly mounted: { readonly current: boolean };
  readonly sink: { readonly current: CallSink };
  readonly set: (change: (now: Shown) => Shown) => void;
};

/**
 * Call a match to a free court (S4 design §7a): the desk's candidates for the court, the server's preview of the one
 * picked and, after the hold, the call. Every route answers a `CallAnswer`; the screen draws what this says. The call is
 * one request at a time (`flags.calling`), a second tap on a candidate is ignored while its preview is out, and a late
 * answer after the sheet has gone changes nothing. The record gets `matchday.call {sid, result}` (`sid` the court id,
 * the allow-list's own word), never a token, a name or a match.
 */
export function useCallCourt(courtId: string, court: string, sinkIn: CallSink): CallView {
  const ports = usePorts();
  const [shown, setShown] = useState<Shown>(FIRST);
  const latest = useRef(shown);
  const flags = useRef<Flags>({ reading: false, previewing: false, calling: false });
  const mounted = useMounted();
  const sink = useRef(sinkIn);
  useEffect(() => {
    sink.current = sinkIn;
    latest.current = shown;
  });
  const set = useCallback((change: (now: Shown) => Shown) => setShown(change), []);
  const deps: Deps = useMemo(
    () => ({ ports, courtId, court, flags, mounted, sink, set }),
    [ports, courtId, court, mounted, set],
  );
  const asks = useMemo(() => asksOf(deps), [deps]);
  useEffect(() => {
    asks.load(null);
  }, [asks]);
  return { ...shown, ...asks.actions(() => latest.current) };
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

type Load = (notice: Line | null) => void;

/** Reads the candidates (one read at a time), the list loading under an optional notice. */
function startLoad(deps: Deps, notice: Line | null): void {
  const { flags } = deps;
  if (flags.current.reading) return;
  flags.current.reading = true;
  deps.set((now) => ({ ...now, step: 'list', picked: null, list: 'loading', notice }));
  void readCandidates(deps)
    .catch(() => deps.ports.logger.warn('matchday.call-failed'))
    .finally(() => {
      flags.current.reading = false;
    });
}

/** Asks the preview of `candidate` (one at a time). */
function startPreview(deps: Deps, candidate: Candidate, load: Load): void {
  const { flags } = deps;
  if (flags.current.previewing) return;
  flags.current.previewing = true;
  deps.set((now) => ({
    ...now,
    step: 'preview',
    picked: candidate,
    preview: 'loading',
    notice: null,
  }));
  void readPreview(deps, candidate, load)
    .catch(() => {
      deps.ports.logger.warn('matchday.call-failed');
      deps.set((now) => ({ ...now, preview: 'offline' }));
    })
    .finally(() => {
      flags.current.previewing = false;
    });
}

/** Sends the call for the ready preview: one at a time, and only from a ready preview. */
function startCall(deps: Deps, now: Shown, load: Load): void {
  const { flags } = deps;
  const { picked } = now;
  if (flags.current.calling || picked === null || now.step !== 'preview' || now.preview !== 'ready')
    return;
  flags.current.calling = true;
  deps.set((s) => ({ ...s, calling: true }));
  void makeCall(deps, picked, load)
    .catch(() => {
      deps.ports.logger.warn('matchday.call-failed');
      deps.sink.current.refresh();
      deps.set((s) => ({ ...s, preview: 'offline' }));
    })
    .finally(() => {
      flags.current.calling = false;
      if (deps.mounted.current) deps.set((s) => ({ ...s, calling: false }));
    });
}

function asksOf(deps: Deps) {
  const { flags } = deps;
  const load: Load = (notice) => startLoad(deps, notice);
  const preview = (candidate: Candidate): void => startPreview(deps, candidate, load);
  return {
    load,
    actions: (read: () => Shown) => ({
      pick: (candidate: Candidate) => {
        const now = read();
        if (candidate.blocked !== null || now.step !== 'list' || now.list !== 'ready') return;
        preview(candidate);
      },
      choose: () => {
        if (!flags.current.calling) load(null);
      },
      retry: () => load(null),
      retryPreview: () => {
        const { picked } = read();
        if (picked !== null && !flags.current.calling) preview(picked);
      },
      call: () => startCall(deps, read(), load),
    }),
  };
}

const OFFLINE = { ok: false, offline: true } as const;

/** A port that throws is no answer: read as offline, and recorded without what it said. */
async function ask<T>(ports: Ports, run: () => Promise<CallAnswer<T>>): Promise<CallAnswer<T>> {
  try {
    return await run();
  } catch {
    ports.logger.warn('matchday.call-threw');
    return OFFLINE;
  }
}

async function readCandidates(deps: Deps): Promise<void> {
  const { ports, courtId } = deps;
  const held = heldCode(ports);
  // No day code to ask with (Exit forgot it, or this build cannot address it): nothing is asked.
  if (held === null) return deps.set((now) => ({ ...now, list: 'offline' }));
  const answer = await ask(ports, () => ports.matchDay.candidates(held.code, courtId));
  if (!deps.mounted.current) return;
  if (answer.ok) {
    const { candidates } = answer.value;
    return deps.set((now) => ({ ...now, list: 'ready', candidates }));
  }
  settleFailure(deps, held, answer, 'candidates', (line) =>
    deps.set((now) => ({ ...now, list: line === null ? 'offline' : 'refused', notice: line })),
  );
}

async function readPreview(
  deps: Deps,
  candidate: Candidate,
  load: (notice: Line | null) => void,
): Promise<void> {
  const { ports, courtId } = deps;
  const held = heldCode(ports);
  if (held === null) return deps.set((now) => ({ ...now, preview: 'offline' }));
  const answer = await ask<CallPreview>(ports, () =>
    ports.matchDay.previewCall(held.code, candidate.match.fixtureId, courtId),
  );
  if (!deps.mounted.current) return;
  if (answer.ok) {
    const { warnings } = answer.value;
    return deps.set((now) => ({ ...now, preview: 'ready', warnings }));
  }
  settleFailure(deps, held, answer, 'preview', (line) => {
    if (line === null) return deps.set((now) => ({ ...now, preview: 'offline' }));
    afterRefusal(deps, line, load);
  });
}

async function makeCall(
  deps: Deps,
  candidate: Candidate,
  load: (notice: Line | null) => void,
): Promise<void> {
  const { ports, courtId } = deps;
  const held = heldCode(ports);
  if (held === null) return deps.set((now) => ({ ...now, preview: 'offline' }));
  const answer = await ask<Called>(ports, () =>
    ports.matchDay.call(held.code, candidate.match.fixtureId, courtId),
  );
  // The word is recorded whether or not the sheet is still there: the call may have landed.
  ports.logger.info('matchday.call', { sid: courtId, result: outcomeOf(answer) });
  if (answer.ok) {
    deps.sink.current.refresh();
    if (deps.mounted.current) deps.sink.current.close();
    return;
  }
  // The call may have landed even when it answered nothing: the list is read again either way.
  deps.sink.current.refresh();
  if (!deps.mounted.current) return;
  settleFailure(deps, held, answer, 'call', (line) => {
    if (line === null) return deps.set((now) => ({ ...now, preview: 'offline' }));
    afterRefusal(deps, line, load);
  });
}

/** A refusal said on the list, with the candidates read again: the match, or the court, is not what it was. */
function afterRefusal(deps: Deps, line: Line, load: (notice: Line | null) => void): void {
  deps.sink.current.refresh();
  load(line);
}

/**
 * What a failed answer comes to: the code itself has gone (the day's handling takes over), or a line to say, or null for
 * no answer the phone can act on. `gone` is the match or court no longer there: "it has moved", and the list is read.
 */
function settleFailure(
  deps: Deps,
  held: Held,
  answer: Exclude<CallAnswer<unknown>, { ok: true }>,
  route: Route,
  say: (line: Line | null) => void,
): void {
  if ('offline' in answer) return say(null);
  if ('gone' in answer) return say({ key: 'matchday.call.moved' });
  const meaning = refusalMeaning(answer.refused, route, deps.court);
  if (meaning !== 'leave') return say(meaning);
  const { refused } = answer;
  const verdict = refusalVerdict({
    ok: false,
    refusal: refused.code as 'MD_UNKNOWN' | 'MD_WITHDRAWN' | 'MD_ENDED' | 'MD_NOT_OPEN',
    ...('opensAt' in refused && refused.opensAt !== undefined ? { opensAt: refused.opensAt } : {}),
  });
  if (verdict.kind === 'stop' || verdict.kind === 'notYet') {
    void leaveDay(deps.ports, held.saved, verdict).catch(() =>
      deps.ports.logger.warn('matchday.leave-failed'),
    );
  }
}

/** The record's word for what a call came to: closed words, never a name. */
export function outcomeOf(answer: CallAnswer<unknown>): string {
  if (answer.ok) return 'called';
  if ('offline' in answer) return 'offline';
  if ('gone' in answer) return 'gone';
  return 'reason' in answer.refused ? answer.refused.reason : answer.refused.code;
}
