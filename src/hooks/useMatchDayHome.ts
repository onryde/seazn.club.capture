import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MatchDay, MatchDayRefusal } from '@/domain/matchday/matchDay';
import { dayHasEnded } from '@/domain/mode/continueCard';
import { dayCodeOf, type SavedDayCode } from '@/domain/mode/dayCode';
import type { ModeCode } from '@/domain/mode/Mode';
import { recognise } from '@/domain/mode/recognise';
import { savedCodeFrom, type SavedCode } from '@/domain/mode/savedCode';
import { scoringHubOf } from '@/hooks/scoringHub';
import type { OpenCode, SetPanel } from '@/hooks/useCodeCheck';
import type { HomeNews, HomePanel, SaveFailed, SetStatusKey } from '@/hooks/useHome';
import { useFormatDay, useFormatTime } from '@/hooks/useFormatTime';
import { useT } from '@/hooks/useLanguage';
import { usePorts, type Ports } from '@/hooks/usePorts';
import type { MessageKey } from '@/i18n/messages';
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
  return refusalVerdict(answer);
}

/**
 * What a call that did not succeed comes to, for any of the code's routes (the day, or an approval's review and
 * approve): the three words that end a code and MD_NOT_OPEN keep the code's own handling; the rest is no answer the
 * phone can act on as the code's.
 */
export function refusalVerdict(answer: Extract<PortAnswer<never>, { ok: false }>): Verdict {
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
  const before = savedDayRaw(ports);
  switch (verdict.kind) {
    case 'open':
      home.setPanel(null);
      await home.openCode(code, null);
      // Review M1: the copy only once its code is saved. A7's Cancel, a refused save or a process death before the save
      // then writes nothing, so a code already saved never loses its own copy to one that went no further.
      if (dayCode !== null && isSaved(ports, code)) await keepCopy(ports, dayCode, verdict.day);
      return letGoOfReplaced(ports, code, before);
    case 'notYet':
      home.setPanel(null);
      await keepUnopened(ports, home, code, dayCode, verdict.news);
      return letGoOfReplaced(ports, code, before);
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

/** The raw text of the day code saved now, or null for none (or a store not loaded). */
function savedDayRaw(ports: Ports): string | null {
  const snapshot = ports.modeStore.getSnapshot();
  return snapshot.status === 'ready' ? (snapshot.saved.codes.matchday?.raw ?? null) : null;
}

/**
 * Final review M2: a different day code now saved in place of `before` lets go of what the first one opened, as Exit
 * does (`letGoOfOpened`), so its matches are not spared for the new day's life. With no code before, a list left by an
 * Exit that died between its steps goes the same way. The same code again, or one that was not saved, lets go of
 * nothing. A refusal is recorded, and the list stays for the next pass.
 */
async function letGoOfReplaced(ports: Ports, code: DayCode, before: string | null): Promise<void> {
  if (before === code.raw || !isSaved(ports, code)) return;
  await scoringHubOf(ports)
    .letGoOfOpened()
    .catch(() => ports.logger.warn('matchday.let-go-refused'));
}

/** The store holds this very code as Match Day's. */
function isSaved(ports: Ports, code: DayCode): boolean {
  const snapshot = ports.modeStore.getSnapshot();
  return snapshot.status === 'ready' && snapshot.saved.codes.matchday?.raw === code.raw;
}

/**
 * Saved, not opened: the active mode stays (`ModeStore.keep`), and the sheet says when the day opens (owner, 2026-11-12;
 * a code that was not saved, a refused keep, shows no sheet).
 */
async function keepUnopened(
  ports: Ports,
  home: Home,
  code: DayCode,
  dayCode: SavedDayCode | null,
  news: HomeNews,
): Promise<void> {
  try {
    await ports.modeStore.keep(savedCodeFrom(code, ports.clock(), null));
  } catch {
    return home.saveFailed('open');
  }
  await showNotOpen(ports, home, dayCode, news);
}

/** The opening a not-yet-open answer named, or null when the server did not say. */
const opensAtOf = (news: HomeNews): Date | null => (typeof news === 'string' ? null : news.at);

/**
 * The sheet over Home, and the record's line that it was shown (no token, no URL). The opening is kept with the code
 * for the tile's line (owner, 2026-11-12); a phone that refuses it is recorded and the sheet shows all the same.
 */
async function showNotOpen(
  ports: Ports,
  home: Home,
  dayCode: SavedDayCode | null,
  news: HomeNews,
): Promise<void> {
  const at = opensAtOf(news);
  if (at !== null && dayCode !== null)
    await ports.matchDayStore
      .writeOpensAt(dayCode, at)
      .catch(() => ports.logger.warn('matchday.cache-refused', { op: 'opens-at' }));
  home.setPanel({ kind: 'dayNotOpen', tapped: 'matchday', at });
  ports.logger.info('matchday.notOpen', { action: 'shown' });
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
      if (verdict.kind === 'notYet') return showNotOpen(ports, home, dayCode, verdict.news);
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
 * The not-yet-open sheet's Close (owner, 2026-11-12): the code goes with its copy, as the day's end forgets it, and the
 * tile scans again. One forget at a time: a second press while one runs does nothing. A forget the phone refuses leaves
 * the code, closes the sheet and says so on Home's line, as every refused write does (R19), and is recorded; the sheet
 * closes, the code stays and the line says the forget was refused.
 */
export function useCloseNotOpen(setPanel: SetPanel, saveFailed: SaveFailed): () => void {
  const ports = usePorts();
  const closing = useRef(false);
  return useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    void forgetNotOpen(ports, setPanel, saveFailed).finally(() => {
      closing.current = false;
    });
  }, [ports, setPanel, saveFailed]);
}

async function forgetNotOpen(
  ports: Ports,
  setPanel: SetPanel,
  saveFailed: SaveFailed,
): Promise<void> {
  const saved = savedDayOf(ports);
  try {
    if (saved !== null) await forgetWithCopy(ports, saved);
  } catch {
    setPanel(closeNotOpenSheet);
    return saveFailed('forget');
  }
  setPanel(closeNotOpenSheet);
  ports.logger.info('matchday.notOpen', { action: 'closed' });
}

const closeNotOpenSheet = (open: HomePanel | null): HomePanel | null =>
  open?.kind === 'dayNotOpen' ? null : open;

function savedDayOf(ports: Ports): SavedCode | null {
  const snapshot = ports.modeStore.getSnapshot();
  return snapshot.status === 'ready' ? (snapshot.saved.codes.matchday ?? null) : null;
}

/**
 * What the Match Day tile's second line says while a code is saved (owner, 2026-11-12): before its day, when it opens
 * (from the day's last copy, else the opening its MD_NOT_OPEN answer named and the store kept; "Code saved" only with neither); from its start to its end, "Tap
 * to open". With no code, after the day's end or a code this build cannot read, null: the tile's own hint stands. The
 * copy is read when the code changes and when a panel closes (a scan writes it); the clock is read as Home renders.
 */
export function useMatchDayHint(saved: SavedCode | null, settled: boolean): string | null {
  const ports = usePorts();
  const { t } = useT();
  const formatDay = useFormatDay();
  const formatTime = useFormatTime();
  const raw = saved?.raw ?? null;
  const dayCode = raw === null ? null : dayCodeOf(raw, ports.hosts);
  const [copy, setCopy] = useState<{
    readonly raw: string;
    readonly day: MatchDay | null;
    readonly opensAt: Date | null;
  } | null>(null);
  useEffect(() => {
    if (raw === null || dayCode === null) return;
    let live = true;
    const hold = (day: MatchDay | null, opensAt: Date | null) =>
      live && setCopy({ raw, day, opensAt });
    Promise.all([
      ports.matchDayStore.readCache(dayCode),
      ports.matchDayStore.readOpensAt(dayCode),
    ]).then(
      ([read, kept]) => hold(read?.day ?? null, kept),
      () => hold(null, null),
    );
    return () => {
      live = false;
    };
    // `dayCode` is rebuilt from `raw` every render: the code's own text is the dependency.
  }, [ports, raw, settled]);
  if (raw === null || dayCode === null) return null;
  const read = copy?.raw === raw ? copy : null;
  const now = ports.clock();
  const day = read?.day ?? null;
  if (day !== null && dayHasEnded(day, now)) return null;
  const opensAt = day?.opensAt ?? read?.opensAt ?? null;
  // A kept opening with no copy cannot know the day's end: it is taken as a day after its opening (a day with a clock
  // change is an hour off, accepted); the tile's tap forgets the code by the server's own MD_ENDED.
  if (day === null && opensAt !== null && now.getTime() >= opensAt.getTime() + DAY_MS) return null;
  if (opensAt === null) return t('home.tile.matchday.saved');
  if (opensAt.getTime() > now.getTime())
    return t('home.tile.matchday.opens', {
      day: formatDay(opensAt, null),
      time: formatTime(opensAt, null),
    });
  return t('home.tile.matchday.tap');
}

const DAY_MS = 24 * 60 * 60 * 1000;
const NO_COURTS: ReadonlyMap<string, string> = new Map();
const sameCourts = (a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean =>
  a.size === b.size && [...a].every(([id, court]) => b.get(id) === court);

/**
 * The matches Exit left sending, each with its court (S4 design §4), read when Home mounts and again whenever its queues
 * read differently (`readKey`: a queue emptying is when the hub lets a match go and drops its note). Nothing until the
 * first read; a read the phone refuses is none, and Home then shows the cards it always has.
 */
export function useSendingCourts(readKey: string): ReadonlyMap<string, string> {
  const { matchDayStore } = usePorts();
  const [held, setHeld] = useState(NO_COURTS);
  useEffect(() => {
    let live = true;
    void matchDayStore.sending().then((now) => {
      if (live) setHeld((was) => (sameCourts(was, now) ? was : now));
    });
    return () => {
      live = false;
    };
  }, [matchDayStore, readKey]);
  return held;
}
