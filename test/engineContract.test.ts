import { describe, expect, it } from 'vitest';
import type { CaptureEnginePort } from '@/engine/CaptureEnginePort';
import { scenarioKit, type EngineUnderTest, type Settle } from './engineContract';

/**
 * Review C4c M-1: carry 28 and PV33 rest on `sendTogether` settling once, after every intent is
 * sent; no scenario can see it, so the kit is held to it here by what an engine is handed, in order.
 */
function recording(ownSettle: boolean): {
  events: string[];
  subject: EngineUnderTest;
  settle: Settle;
} {
  const events: string[] = [];
  const engine: CaptureEnginePort = {
    send: (intent) => {
      events.push(`send ${intent.kind}`);
    },
    subscribe: () => () => undefined,
    getSnapshot: () => {
      throw new Error('the kit is not asked for a snapshot here');
    },
  };
  const own: Settle = async () => {
    events.push("the engine's settle");
  };
  return {
    events,
    subject: {
      engine,
      say: () => undefined,
      ready: () => undefined,
      dispose: () => undefined,
      ...(ownSettle ? { settle: own } : {}),
    },
    settle: async () => {
      events.push('settle');
    },
  };
}

describe('the scenario kit', () => {
  it('sendTogether sends every intent, then settles once', async () => {
    const { events, subject, settle } = recording(false);
    await scenarioKit(subject, settle).sendTogether([
      { kind: 'stop' },
      { kind: 'reset' },
      { kind: 'start' },
    ]);
    expect(events).toEqual(['send stop', 'send reset', 'send start', 'settle']);
  });

  it('send settles after each intent', async () => {
    const { events, subject, settle } = recording(false);
    const kit = scenarioKit(subject, settle);
    await kit.send({ kind: 'stop' });
    await kit.send({ kind: 'reset' });
    expect(events).toEqual(['send stop', 'settle', 'send reset', 'settle']);
  });

  it("an engine's own settle replaces the kit's, once a step", async () => {
    const { events, subject, settle } = recording(true);
    await scenarioKit(subject, settle).sendTogether([{ kind: 'stop' }, { kind: 'reset' }]);
    expect(events).toEqual(['send stop', 'send reset', "the engine's settle"]);
  });
});
