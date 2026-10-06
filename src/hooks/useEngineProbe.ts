import { useCallback, useState } from 'react';
import type { CaptureEnginePort, EngineIntent, EngineSnapshot } from '@/engine/CaptureEnginePort';
import {
  ENGINE_SCENARIOS,
  type Scenario,
  type ScenarioKit,
} from '@/engine/contract/engineScenarios';
import type { NativeCaptureEngine } from '@/engine/nativeCaptureEngine';
import { selectStateKind } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { usePorts } from '@/hooks/usePorts';
import { createLogger, type Logger } from '@/services/logger';
import type { SessionRecord } from '@/services/sessionRecord';

export type ProbeState = 'idle' | 'running' | 'passed' | 'failed';

/** CD8's ack, the permission answer that lands after it (Task 38), and the way back to idle, each bounded. */
export const PROBE_WAIT_MS = 5_000;
/** How often a bounded wait reads the engine again (C4c carry (a)). */
const POLL_MS = 50;

/** The scenarios a phone runs, each with its index in the whole tree: the `scene` a line names (review C5 m-4). */
const PHONE_SCENES: readonly (readonly [scene: number, scenario: Scenario])[] = [
  ...ENGINE_SCENARIOS.entries(),
].filter(([, scenario]) => scenario.onPhone);

type StopReason = 'no-ack' | 'stuck-pairing' | 'not-idle' | 'unsupported';

class ProbeStop extends Error {
  constructor(readonly reason: StopReason) {
    super(reason);
  }
}

/**
 * The engine contract on a phone, against the real bridge (CD24): the
 * scenarios that send no start and need no server word. Dev builds only, with
 * native wired and the engine idle. Each line carries numbers only: a phrase
 * under a plain key is masked whole (CD6), and a scenario never logs a token.
 *
 * PV35: a failed readout stays until the operator dismisses it, whatever the
 * failed scene left the engine in; a run starts only from idle.
 */
export function useEngineProbe(): {
  run(): void;
  dismiss(): void;
  state: ProbeState;
} | null {
  const ports = usePorts();
  const kind = useEngineSelector(selectStateKind);
  const [state, setState] = useState<ProbeState>('idle');
  const run = useCallback(() => {
    const native = ports.nativeEngine;
    const flight = ports.probeFlight;
    if (flight.active() || native === null) return;
    if (ports.engine.getSnapshot().state.kind !== 'idle') return;
    // F-S4-2: up for the whole run, clean-up included, so the reopen gate leaves the pairing alone.
    flight.begin();
    setState('running');
    const logger = probeLogger(ports.record, native, () => ports.clock().getTime());
    // Re-review 3 m3: lowered however the run ends, a rejection included, which reads as a failed run.
    void probe(ports.engine, native, logger)
      .finally(() => flight.end())
      .then(
        (passed) => setState(passed ? 'passed' : 'failed'),
        () => setState('failed'),
      );
  }, [ports]);
  const dismiss = useCallback(() => {
    if (!ports.probeFlight.active()) setState('idle');
  }, [ports]);
  const offered = ports.devTools && ports.devEngine === null && ports.nativeEngine !== null;
  if (!offered) return null;
  if (kind !== 'idle' && state !== 'running' && state !== 'failed') return null;
  return { run, dismiss, state };
}

/**
 * Device session 4, F-S4-2: the probe's lines, written to native's record whatever the engine's state. The
 * probe starts at idle and each scene ends there, and a scene can fail there, where M16 files a JS line in
 * the ring only, which the record a phone shares never holds: session 4's run lost its `probe.fail`. Native
 * hands its lines back to the ring, so the readout's view still has them. Exported for its tests.
 */
export function probeLogger(
  record: SessionRecord,
  native: Pick<NativeCaptureEngine, 'forward'>,
  now: () => number,
): Logger {
  return createLogger({ record: { ...record, append: (entry) => native.forward(entry) }, now });
}

async function probe(
  engine: CaptureEnginePort,
  native: NativeCaptureEngine,
  logger: Logger,
): Promise<boolean> {
  logger.info('probe.skip', { count: ENGINE_SCENARIOS.length - PHONE_SCENES.length });
  for (const [scene, scenario] of PHONE_SCENES) {
    const checks = { count: 0 };
    try {
      await scenario.run(probeKit(engine, native, checks));
      // A scene passes once the engine is back at idle (review C5 m-3): never a pass and a fail.
      await leaveClean(engine, native);
      logger.info('probe.pass', { scene });
    } catch (error) {
      const reason = error instanceof ProbeStop ? error.reason : 'mismatch';
      logger.warn(
        'probe.fail',
        reason === 'mismatch' ? { scene, check: checks.count, reason } : { scene, reason },
      );
      await giveBack(engine, native);
      return false;
    }
  }
  return true;
}

/**
 * The kit over the bridge: each step waits for its ack, then for Pairing to
 * settle; `sendTogether` sends every intent before its one settle (PV33). A
 * start, a server word and readiness are refused before anything is sent: on a
 * phone a start goes on air for real, and there is no scripted server.
 * `checks` counts the scenario's snapshot reads, up to and including the one
 * that failed: where in the scenario it failed, without the phrase (which may
 * not reach the record). One `same` can read more than once, so it is not that
 * `same`'s ordinal (review C5 m-12). Exported for its tests.
 */
export function probeKit(
  engine: CaptureEnginePort,
  native: NativeCaptureEngine,
  checks: { count: number },
): ScenarioKit {
  const unsupported = () => Promise.reject(new ProbeStop('unsupported'));
  const sendAll = async (intents: readonly EngineIntent[]) => {
    if (intents.some((intent) => intent.kind === 'start')) return unsupported();
    for (const intent of intents) engine.send(intent);
    await settle(engine, native);
  };
  return {
    send: (intent) => sendAll([intent]),
    sendTogether: sendAll,
    say: unsupported,
    ready: unsupported,
    live: unsupported,
    snapshot: () => {
      checks.count += 1;
      return engine.getSnapshot();
    },
  };
}

async function settle(engine: CaptureEnginePort, native: NativeCaptureEngine): Promise<void> {
  await bounded(native.settled(), 'no-ack');
  // The permission answer lands after the pair's ack (Task 38).
  await eventually(engine, (snapshot) => snapshot.state.kind !== 'pairing', 'stuck-pairing');
}

function bounded(work: Promise<void>, reason: StopReason): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ProbeStop(reason)), PROBE_WAIT_MS);
    work.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        reject(new ProbeStop(reason));
      },
    );
  });
}

/**
 * C4c carry (a): a bounded eventual poll. Work an input posts in turn lands up
 * to a tick after its ack, so the probe reads until `holds`, or stops at the
 * bound; never once at the ack, never on "the next snapshot event".
 */
function eventually(
  engine: CaptureEnginePort,
  holds: (snapshot: EngineSnapshot) => boolean,
  reason: StopReason,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (holds(engine.getSnapshot())) return resolve();
    const poll = setInterval(() => {
      if (!holds(engine.getSnapshot())) return;
      clearInterval(poll);
      clearTimeout(bound);
      resolve();
    }, POLL_MS);
    const bound = setTimeout(() => {
      clearInterval(poll);
      reject(new ProbeStop(reason));
    }, PROBE_WAIT_MS);
  });
}

/**
 * Between scenarios, as the kit starts each: unpair, stop, reset, each acked,
 * then idle (PV35). `live` turns false once a caller has given up on it, so an
 * ack that lands later sends nothing more.
 */
async function leaveClean(
  engine: CaptureEnginePort,
  native: NativeCaptureEngine,
  live: () => boolean = () => true,
): Promise<void> {
  for (const kind of ['unpair', 'stop', 'reset'] as const) {
    if (!live()) return;
    engine.send({ kind });
    await bounded(native.settled(), 'no-ack');
  }
  await eventually(engine, (snapshot) => snapshot.state.kind === 'idle', 'not-idle');
}

/**
 * Review C5 I-1: after a failure, the same clean-up, best effort, so a failed
 * scene does not leave the phone paired to a made-up code. One bound for all
 * of it, and its own stop is swallowed: the readout names the scene's failure,
 * and the reopen gate's orphan rule is the backstop for an engine still paired.
 */
async function giveBack(engine: CaptureEnginePort, native: NativeCaptureEngine): Promise<void> {
  let live = true;
  await bounded(
    leaveClean(engine, native, () => live),
    'not-idle',
  ).catch(() => undefined);
  live = false;
}
