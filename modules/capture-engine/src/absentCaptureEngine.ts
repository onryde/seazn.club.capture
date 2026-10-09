import { tokenTag } from '@/domain/credentials/tokenTag';
import type { PairingInfo } from '@/domain/session/Pairing';
import type { CaptureEnginePort, EngineSnapshot, PairIntent } from './CaptureEnginePort';
import { UNREPORTED } from './unreported';

/** What an absent engine names a code by: the intent's name, and nothing the claim would have told it. */
const namedBy = (intent: PairIntent): PairingInfo => ({
  code: intent.code,
  slot: intent.slot,
  tokenTag: tokenTag(intent.token),
  automatic: intent.automatic,
  label: '',
  venueTimezone: '',
  scheduledStart: null,
  autoAllowed: false,
  destinationName: null,
  pollSeconds: 60,
  stageLabel: null,
});

/**
 * CD23: the port with no native module behind it, so the app is one that
 * cannot stream rather than one that crashes. Three snapshots and no timers:
 * idle, ended fatal-error naming the code a `pair` sent, idle again after
 * `reset`. Every other intent is ignored, as native ignores one that does not
 * fit (AGENTS §2).
 */
export function createAbsentCaptureEngine(now: () => number): CaptureEnginePort {
  const listeners = new Set<() => void>();
  let snapshot: EngineSnapshot = { ...UNREPORTED, reportedAtMs: now() };
  const show = (next: Partial<EngineSnapshot>) => {
    snapshot = { ...snapshot, ...next, reportedAtMs: now() };
    for (const listener of listeners) listener();
  };
  return {
    send: (intent) => {
      const { kind } = snapshot.state;
      if (intent.kind === 'pair' && kind === 'idle') {
        show({
          state: { kind: 'ended', reason: 'fatal-error', durationMs: null },
          pairing: namedBy(intent),
        });
      }
      if (intent.kind === 'reset' && kind === 'ended')
        show({ state: { kind: 'idle' }, pairing: null });
    },
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getSnapshot: () => snapshot,
  };
}
