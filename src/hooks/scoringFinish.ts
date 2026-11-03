import { finishOf, type Finish } from '@/domain/scoring/scoringFinish';
import { openMatch } from '@/domain/scoring/scoringMatch';
import { sportFor } from '@/domain/scoring/sports';
import type { Ports } from '@/hooks/usePorts';
import { readScoringLink } from '@/services/scoringLinkStore';

type FinishPorts = Pick<Ports, 'kv' | 'hosts' | 'tapQueue' | 'clock'>;

/**
 * Whether the saved match is over, read from what the phone keeps and nothing else (owner ruling 41, 2026-11-02): Home
 * asks with no runner and maybe no signal, and a match is never opened to be asked. The link names the sport (the one
 * file every runner reads first), and the ledger, the cached bootstrap and the queue are what the pad folds; the match is
 * opened from them as the pad opens it and `finishOf` reads it (the pad's own rules).
 *
 * Null is "not known to be over", and Home then says Continue: no link, a sport this build does not score, no bootstrap
 * cached (a match scanned and never opened), a file that cannot be read. The stores never reject a read (a refused read
 * is a file they report as unreadable and answer null for), so a refusal can only make this say "not over". No queue file
 * is a queue with no taps: another scorer may have taken the match to its end.
 */
export async function readFinish(ports: FinishPorts, fixtureId: string): Promise<Finish | null> {
  const stored = await readScoringLink(ports.kv, fixtureId, ports.hosts[0] ?? '');
  if (stored.kind !== 'link') return null;
  const sport = sportFor(stored.sportKey);
  if (sport === null) return null;
  const [queue, ledger, boot] = await Promise.all([
    ports.tapQueue.load(fixtureId),
    ports.tapQueue.loadLedger(fixtureId),
    ports.tapQueue.loadBoot(fixtureId),
  ]);
  if (boot === null) return null;
  const opened = openMatch(
    {
      sport,
      queue: queue ?? { fixtureId, label: '', pending: [], ownEventIds: [], dead: null },
      ledger: ledger ?? [],
      bootstrap: boot.bootstrap,
      toss: boot.toss,
      judge: 'fold',
      foreground: true,
      rulesVersion: boot.bootstrap.rulesVersion,
      decidedAt: null,
    },
    ports.clock().getTime(),
  );
  return finishOf(opened.state);
}
