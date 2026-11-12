import { useCallback, useRef } from 'react';
import type { Row } from '@/domain/matchday/matchDay';
import { dayCodeOf, type SavedDayCode } from '@/domain/mode/dayCode';
import { recognise } from '@/domain/mode/recognise';
import type { KeptLink } from '@/hooks/scoringOpen';
import { keepScoringLink } from '@/hooks/scoringOpen';
import { usePorts, type Ports } from '@/hooks/usePorts';
import type { MessageKey } from '@/i18n/messages';
import { readScoringLink } from '@/services/scoringLinkStore';
import type { PortAnswer } from '@/services/matchDayPort';
import type { OpenAnswer } from '@/domain/matchday/openWire';

/** What the list does with the answer: say one line on it (null clears the last), or read the day again. */
export type OpenSink = {
  readonly say: (line: MessageKey | null) => void;
  readonly refresh: () => void;
};

type Opening = { readonly row: Row; readonly courtName: string; readonly code: SavedDayCode };

/**
 * A tap on a Match Day row (S4 design §6; MD-2 Task 5): ask the server for the match's scoring link through the day
 * code, keep it exactly as a scan of the match's own code does (`keepScoringLink`, the link first), note the match as
 * opened by Match Day and as the one open, and go to the pad. The active mode stays Match Day.
 *
 * - A link opens it. A `finished` answer carries no link, so it opens only a match whose link this phone already holds
 *   (view only, from the ledger it has); with none there is nothing to open and the record says so.
 * - MD_OUT_OF_SCOPE says "This match isn't on your courts" on the list and goes nowhere. Any other refusal, or the
 *   match gone, is the code's or the day's: the list reads the day again, which forgets what has ended and goes Home.
 * - Offline opens a link already stored, else says "Offline" on the list.
 *
 * A second tap while one is out is ignored. The port never rejects, and one that does is read as offline and recorded.
 */
export function useOpenFromMatchDay(
  sink: OpenSink,
): (row: Row, courtName: string) => Promise<void> {
  const ports = usePorts();
  const flying = useRef(false);
  const { say, refresh } = sink;
  return useCallback(
    async (row, courtName) => {
      if (flying.current) return;
      flying.current = true;
      try {
        say(null);
        const code = savedDayCode(ports);
        if (code === null) return;
        const answer = await askOpen(ports, code, row.fixtureId);
        await settle(ports, { row, courtName, code }, answer, { say, refresh });
      } catch {
        ports.logger.warn('matchday.open-failed');
        say('store.saveFailed');
      } finally {
        flying.current = false;
      }
    },
    [ports, say, refresh],
  );
}

/** The saved day code, as this build can address it; none when none is saved. */
function savedDayCode(ports: Ports): SavedDayCode | null {
  const snapshot = ports.modeStore.getSnapshot();
  const saved = snapshot.status === 'ready' ? snapshot.saved.codes.matchday : undefined;
  return saved === undefined ? null : dayCodeOf(saved.raw, ports.hosts);
}

const OFFLINE: PortAnswer<OpenAnswer> = { ok: false, offline: true };

async function askOpen(
  ports: Ports,
  code: SavedDayCode,
  fixtureId: string,
): Promise<PortAnswer<OpenAnswer>> {
  try {
    return await ports.matchDay.open(code, fixtureId);
  } catch {
    ports.logger.warn('matchday.open-threw');
    return OFFLINE;
  }
}

async function settle(
  ports: Ports,
  opening: Opening,
  answer: PortAnswer<OpenAnswer>,
  sink: OpenSink,
): Promise<void> {
  if (answer.ok) {
    const { value } = answer;
    if (value.kind === 'refused') return sink.say('matchday.outOfScope');
    if (value.kind === 'link') return openLink(ports, opening, value, sink);
    return openStored(ports, opening, sink, 'matchday.open-finished-no-link');
  }
  if ('offline' in answer) return openStored(ports, opening, sink, null, 'matchday.offlineEmpty');
  // A refusal of the code itself (ended, withdrawn, not open yet) or a match that is gone: the day decides.
  sink.refresh();
}

/** The match's own link, kept as a scan's is; then the match is the one open and the pad shows. */
async function openLink(
  ports: Ports,
  { row, courtName }: Opening,
  link: Extract<OpenAnswer, { kind: 'link' }>,
  sink: OpenSink,
): Promise<void> {
  const scanned = recognise(link.url, ports.clock(), ports.hosts);
  if (scanned.outcome !== 'code' || scanned.code.mode !== 'scoring') {
    ports.logger.warn('matchday.open-foreign-link');
    return sink.say('matchday.offlineEmpty');
  }
  let kept: KeptLink | null = null;
  try {
    kept = await keepScoringLink(ports, scanned.code.token, {
      kind: 'scan',
      match: { fixtureId: row.fixtureId, label: '' },
      sportKey: link.sportKey,
    });
    await enter(ports, row.fixtureId, courtName);
  } catch {
    // The link kept for a match that did not open is taken away again, as a refused scan's is.
    await kept?.undo().catch(() => ports.logger.warn('scoring.orphan-link-kept', {}));
    return sink.say('store.saveFailed');
  } finally {
    kept?.release();
  }
  ports.navigation.go('scoring');
}

/**
 * A link already held for the match (offline, or a finished match): the pad opens from it. With none, `silent` is the
 * record's line for a state the list has no words for, or `line` is what the list says.
 */
async function openStored(
  ports: Ports,
  { row, courtName }: Opening,
  sink: OpenSink,
  silent: string | null,
  line: MessageKey | null = null,
): Promise<void> {
  const stored = await readScoringLink(ports.kv, row.fixtureId, ports.hosts[0] ?? '');
  if (stored.kind !== 'link') {
    if (silent !== null) ports.logger.warn(silent);
    if (line !== null) sink.say(line);
    return;
  }
  try {
    await enter(ports, row.fixtureId, courtName);
  } catch {
    return sink.say('store.saveFailed');
  }
  ports.navigation.go('scoring');
}

/** Match Day holds the match (the hub's sweep spares it) and it is the one open, before anything shows it. */
async function enter(ports: Ports, fixtureId: string, courtName: string): Promise<void> {
  await ports.matchDayStore.addOpened(fixtureId);
  await ports.matchDayStore.setOpen({ fixtureId, courtName });
}
