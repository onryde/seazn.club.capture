import { isLinkDead } from '@/domain/scoring/queue';
import type { SavedScoring } from '@/domain/mode/savedCode';
import type { Ports } from '@/hooks/usePorts';
import { scoringHubOf } from '@/hooks/scoringHub';
import { forgetScoringLink, readScoringLink, saveScoringLink } from '@/services/scoringLinkStore';

/**
 * The disk half of opening a Remote Scoring match from Home (plan S2-1 Task 10; design §4 step 1, §4.3), over `Ports`
 * so Home's hooks stay about the screen. Nothing here decides what Home shows.
 */
type ScoringPorts = Pick<Ports, 'kv' | 'hosts' | 'tapQueue' | 'logger'>;

/** The link goes where every read finds it: the build's own origin, and the scanned token, under the match's key. */
export const linkOf = (ports: Pick<Ports, 'hosts'>, token: string) => ({
  origin: `https://${ports.hosts[0] ?? ''}`,
  token,
});

/**
 * What a scan holds once its link is kept. `undo` puts the link back the way it was found: gone when the match had none
 * before. `release` lets the hub's clean-ups at the match again; the caller calls it once the code that names the match
 * is in or refused.
 */
export type KeptLink = { readonly undo: () => Promise<void>; readonly release: () => void };

/**
 * Saves the link, BEFORE the code that names its match: a kill between the two leaves a link nothing opens, never a
 * code with no link behind it. A queue that died on its link is made sendable again by the fresh one (design §4.3: a
 * new link for the same match replaces the old and the queue goes on); a queue dead for any other word stays dead,
 * since no link changes what the match is. Rejects when a write is refused: the caller opens nothing.
 *
 * Answers how to take the link back: if the code that names the match is then refused, the caller calls `undo`, so no
 * token is left in the store with no code behind it. A match that had a link before keeps one (the fresh one replaced
 * it, and both are the organiser's); a store that did not answer on the first look is not asked to delete.
 *
 * The match is claimed from the hub for the time between the link and the code (the match is not yet the saved one, so
 * a clean-up would take a link nobody has opened): `release` ends it, and a refusal here ends it itself.
 */
export async function keepScoringLink(
  ports: Ports,
  token: string,
  scoring: SavedScoring,
): Promise<KeptLink> {
  const release = scoringHubOf(ports).claim(scoring.fixtureId);
  try {
    return { undo: await writeLink(ports, token, scoring), release };
  } catch (error) {
    release();
    throw error;
  }
}

/** The link, written and the queue revived; the undo of it. Takes the link back itself when the revive is refused. */
async function writeLink(
  ports: Ports,
  token: string,
  scoring: SavedScoring,
): Promise<() => Promise<void>> {
  const host = ports.hosts[0] ?? '';
  const had = (await readScoringLink(ports.kv, scoring.fixtureId, host)).kind !== 'none';
  await saveScoringLink(ports.kv, scoring.fixtureId, linkOf(ports, token), host);
  const undo = async (): Promise<void> => {
    if (!had) await forgetScoringLink(ports.kv, scoring.fixtureId);
  };
  try {
    const queue = await ports.tapQueue.load(scoring.fixtureId);
    if (queue !== null && isLinkDead(queue.dead))
      await ports.tapQueue.save({ ...queue, dead: null });
  } catch (error) {
    await undo().catch(() => undefined);
    throw error;
  }
  return undo;
}

/**
 * The match the saved code replaces is let go when nothing of it is left to send: its link, queue, ledger and boot
 * cache go (the hub's Dismiss). A match with taps still queued, dead or live, or whose queue cannot be read, is kept: its
 * taps show on Home as a leftover (design §5), and only the organiser's word or the operator's Dismiss removes them.
 */
export async function letGoOfScoring(
  ports: Ports,
  previous: string | null,
  next: string,
): Promise<void> {
  if (previous === null || previous === next) return;
  const entries = await ports.tapQueue.list();
  const left = entries.find((entry) =>
    entry.kind === 'queue' ? entry.queue.fixtureId === previous : entry.fixtureId === previous,
  );
  if (left !== undefined && (left.kind === 'unreadable' || left.queue.pending.length > 0)) return;
  await scoringHubOf(ports).dismiss(previous);
}

/**
 * Dismiss, for a bad-link panel or a leftover card: the match goes (runner, link, queue, ledger and boot cache: the
 * hub's), and if it was the saved scoring match its code goes with it, so Home has no card for a match with nothing
 * behind it. Rejects when the disk or the store refuses; the caller says so.
 */
export async function dismissMatch(ports: Ports, fixtureId: string): Promise<void> {
  await scoringHubOf(ports).dismiss(fixtureId);
  const snapshot = ports.modeStore.getSnapshot();
  const saved = snapshot.status === 'ready' ? (snapshot.saved.codes.scoring ?? null) : null;
  if (saved?.scoring?.fixtureId === fixtureId) await ports.modeStore.forget(saved);
}

/**
 * Which match's queue of unsent taps is stuck on THIS dead link, if any: the Dismiss a bad-link panel offers when the
 * same link is scanned again (design §4.3). Only a queue dead on its link, whose stored token is the scanned one. A
 * store that fails to answer finds none: the panel then simply has no Dismiss.
 */
export async function stuckOnLink(ports: ScoringPorts, token: string): Promise<string | null> {
  try {
    for (const entry of await ports.tapQueue.list()) {
      if (entry.kind !== 'queue' || !isLinkDead(entry.queue.dead)) continue;
      const stored = await readScoringLink(ports.kv, entry.queue.fixtureId, ports.hosts[0] ?? '');
      if (stored.kind === 'link' && stored.link.token === token) return entry.queue.fixtureId;
    }
  } catch {
    return null;
  }
  return null;
}
