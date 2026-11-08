import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MatchDay, MatchDayRefusal } from '@/domain/matchday/matchDay';
import { dayHasEnded, matchDayCard, type MatchDayCopy } from '@/domain/mode/continueCard';
import { dayCodeOf, type SavedDayCode } from '@/domain/mode/dayCode';
import type { ModeCode } from '@/domain/mode/Mode';
import { recognise } from '@/domain/mode/recognise';
import { savedCodeFrom, type SavedCode } from '@/domain/mode/savedCode';
import type { OpenCode, SetPanel } from '@/hooks/useCodeCheck';
import type { HomeNews, HomePanel, SaveFailed, SetStatusKey } from '@/hooks/useHome';
import { usePorts, type Ports } from '@/hooks/usePorts';
import type { MessageKey } from '@/i18n/messages';
import type { CachedDay } from '@/services/matchDayStore';
import type { PortAnswer } from '@/services/matchDayPort';

export type DayCode = Extract<ModeCode, { mode: 'matchday' }>;

/** What Home's Match Day flows need of useHome's: how to open a code, the panel, the line, and a refused write. */
type Home = {
  readonly openCode: OpenCode;
  readonly setPanel: SetPanel;
  readonly setStatusKey: SetStatusKey;
  readonly saveFailed: SaveFailed;
};

const CHECKING: HomePanel = { kind: 'checking', tapped: 'matchday' };

/**
 * What a day answer comes to, on Home and on Match Day's list (S4 design §3, §4, §5): the day, to open; not open yet,
 * kept with its opening on the line; one of the three words that end a code (each with its own line); or no answer the
 * phone can act on. The two refusals carry the server's word.
 */
export type Verdict =
  | { readonly kind: 'open'; readonly day: MatchDay }
  | { readonly kind: 'notYet'; readonly news: HomeNews; readonly refusal: 'MD_NOT_OPEN' }
  | { readonly kind: 'stop'; readonly line: MessageKey; readonly refusal: MatchDayRefusal }
  | { readonly kind: 'offline' };

const OFFLINE: Verdict = { kind: 'offline' };
const STOP_LINE: Partial<Readonly<Record<MatchDayRefusal, MessageKey>>> = {
  MD_ENDED: 'matchday.ended',
  MD_WITHDRAWN: 'matchday.withdrawn',
  MD_UNKNOWN: 'matchday.unknown',
};

function verdictOf(answer: PortAnswer<MatchDay>): Verdict {
  if (answer.ok) return { kind: 'open', day: answer.value };
  if (!('refusal' in answer)) return OFFLINE;
  if (answer.refusal === 'MD_NOT_OPEN') {
    const { opensAt } = answer;
    return {
      kind: 'notYet',
      news: opensAt === undefined ? 'matchday.notOpen' : { key: 'matchday.opens', at: opensAt },
      refusal: answer.refusal,
    };
  }
  const line = STOP_LINE[answer.refusal];
  return line === undefined ? OFFLINE : { kind: 'stop', line, refusal: answer.refusal };
}

/**
 * The day, asked of the server. A code this build cannot address (`dayCodeOf` null), and a port that throws, are no
 * answer; a throw is recorded, never with the token. The port protects the token before it asks.
 */
export async function askDay(ports: Ports, code: SavedDayCode | null): Promise<Verdict> {
  if (code === null) return OFFLINE;
  try {
    return verdictOf(await ports.matchDay.day(code));
  } catch {
    ports.logger.warn('matchday.answer', { op: 'day', kind: 'offline', problem: 'port-threw' });
    return OFFLINE;
  }
}

/** The day's last good copy, for its code; a write the phone refuses is recorded, and the day still opens. */
export async function keepCopy(ports: Ports, code: SavedDayCode, day: MatchDay): Promise<void> {
  await ports.matchDayStore
    .writeCache(code, day, ports.clock())
    .catch(() => ports.logger.warn('matchday.cache-refused', { op: 'write' }));
}

/**
 * Home's first scan of a Match Day code (S4 design §4 "First time"; MD-2 Task 3): the server is asked before anything
 * is saved, so a code that does not work never lands in the store, and a process death mid-check leaves nothing to
 * reopen. Answered, the day's copy is kept and the code opens (A7 first while Live Stream is paired). Before its day it
 * is kept and nothing opens: the line says when it opens. A code that has ended, been withdrawn or is unknown saves
 * nothing and says which. No answer saves nothing and offers Try again. One check at a time: a second call while one
 * is in flight asks and saves nothing more. A store that is not ready is not asked (R12). The day's copy is kept only
 * once its code is saved.
 */
export function useDayCheck(home: Home): (code: DayCode) => Promise<void> {
  const ports = usePorts();
  const checking = useRef(false);
  return useCallback(
    async (code: DayCode) => {
      // R12: a store that is not ready is not asked. Unreachable from Home today, whose every way here is behind the
      // tile's own ready check (an equivalent mutant), and kept so the rule does not rest on its callers.
      if (ports.modeStore.getSnapshot().status !== 'ready' || checking.current) return;
      checking.current = true;
      try {
        home.setPanel(CHECKING);
        const dayCode = dayCodeOf(code.raw, ports.hosts);
        await afterScan(ports, home, code, dayCode, await askDay(ports, dayCode));
      } finally {
        checking.current = false;
      }
    },
    [ports, home],
  );
}

async function afterScan(
  ports: Ports,
  home: Home,
  code: DayCode,
  dayCode: SavedDayCode | null,
  verdict: Verdict,
): Promise<void> {
  switch (verdict.kind) {
    case 'open':
      home.setPanel(null);
      await home.openCode(code, null);
      // Review M1: the copy only once its code is saved. A7's Cancel, a refused save or a process death before the save
      // then writes nothing, so a code already saved never loses its own copy to one that went no further.
      if (dayCode !== null && isSaved(ports, code)) await keepCopy(ports, dayCode, verdict.day);
      return;
    case 'notYet':
      home.setPanel(null);
      return keepUnopened(ports, home, code, verdict.news);
    case 'stop':
      return home.setPanel({ kind: 'dayRefused', tapped: 'matchday', line: verdict.line });
    case 'offline':
      return home.setPanel({
        kind: 'codeError',
        tapped: 'matchday',
        error: { kind: 'offline' },
        code,
      });
  }
}

/** The store holds this very code as Match Day's. */
function isSaved(ports: Ports, code: DayCode): boolean {
  const snapshot = ports.modeStore.getSnapshot();
  return snapshot.status === 'ready' && snapshot.saved.codes.matchday?.raw === code.raw;
}

/** Saved, not opened: the active mode stays (`ModeStore.keep`), and the line says when the day opens. */
async function keepUnopened(
  ports: Ports,
  home: Home,
  code: DayCode,
  news: HomeNews,
): Promise<void> {
  try {
    await ports.modeStore.keep(savedCodeFrom(code, ports.clock(), null));
  } catch {
    return home.saveFailed('open');
  }
  home.setStatusKey(news);
}

/**
 * The Match Day tile with a code saved (S4 design §4 "After that"): it opens the saved day and never scans while the
 * code is valid. The day is asked first, so an ended, withdrawn or unknown code is found here, forgotten with its copy,
 * and the scanner opens under a line that says why; a day past its end by the last copy is known without asking. A
 * code kept before its day says when it opens. With no answer the day opens anyway, and its list shows its last copy
 * (§5). Runs inside the tile's scan flight, so a second tap asks nothing more. A saved code this build cannot read is
 * scanned over.
 */
export function useOpenSavedDay(
  home: Home,
): (saved: SavedCode, scan: () => Promise<void>) => Promise<void> {
  const ports = usePorts();
  return useCallback(
    async (saved: SavedCode, scan: () => Promise<void>) => {
      const recognised = recognise(saved.raw, ports.clock(), ports.hosts);
      const dayCode = dayCodeOf(saved.raw, ports.hosts);
      if (recognised.outcome !== 'code' || recognised.code.mode !== 'matchday' || dayCode === null)
        return scan();
      const cached = await ports.matchDayStore.readCache(dayCode);
      if (cached !== null && dayHasEnded(cached.day, ports.clock()))
        return stop(ports, home, saved, 'matchday.ended', scan);
      home.setPanel(CHECKING);
      const verdict = await askDay(ports, dayCode);
      home.setPanel(closeChecking);
      if (verdict.kind === 'stop') return stop(ports, home, saved, verdict.line, scan);
      if (verdict.kind === 'notYet') return home.setStatusKey(verdict.news);
      if (verdict.kind === 'open') await keepCopy(ports, dayCode, verdict.day);
      return home.openCode(recognised.code, null);
    },
    [ports, home],
  );
}

/** Closes the check's panel, and only it: a panel that replaced it stays. */
const closeChecking = (open: HomePanel | null): HomePanel | null =>
  open?.kind === 'checking' ? null : open;

/**
 * S4 design §4: the day is over for this code, so it is forgotten with its copy (the opened matches stay: their links
 * outlive the code), the line says why, and the scanner opens for a new one. A refused forget says so and scans nothing.
 */
async function stop(
  ports: Ports,
  home: Home,
  saved: SavedCode,
  line: MessageKey,
  scan: () => Promise<void>,
): Promise<void> {
  try {
    await forgetWithCopy(ports, saved);
  } catch {
    return home.saveFailed('forget');
  }
  home.setStatusKey(line);
  return scan();
}

/**
 * A day code that is over goes with its copy (S4 design §4), if the store still holds it; the opened matches stay, as
 * their links outlive the code. A refused forget rejects, and nothing is cleared; a refused clear is recorded.
 */
export async function forgetWithCopy(ports: Ports, saved: SavedCode): Promise<void> {
  if (!(await ports.modeStore.forget(saved))) return;
  await ports.matchDayStore
    .clearCache()
    .catch(() => ports.logger.warn('matchday.cache-refused', { op: 'clear' }));
}

/**
 * The Match Day Continue card's words (S4 design §4): from the saved code's own copy of its day, read when the code
 * changes. No card without a copy, for another code's copy (`readCache` is tagged), or past the day's end.
 */
export function useMatchDayCard(saved: SavedCode | null): MatchDayCopy | null {
  const { matchDayStore, hosts, clock } = usePorts();
  const [read, setRead] = useState<{ readonly of: SavedCode; readonly copy: CachedDay } | null>(
    null,
  );
  useEffect(() => {
    const code = saved === null ? null : dayCodeOf(saved.raw, hosts);
    if (saved === null || code === null) return;
    let live = true;
    void matchDayStore.readCache(code).then((copy) => {
      if (live) setRead(copy === null ? null : { of: saved, copy });
    });
    return () => {
      live = false;
    };
  }, [saved, hosts, matchDayStore]);
  const copy = read !== null && read.of === saved ? read.copy : null;
  return useMemo(() => matchDayCard(copy, clock()), [copy, clock]);
}
