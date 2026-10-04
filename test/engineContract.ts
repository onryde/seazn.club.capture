import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Readiness } from '@/domain/session/Pairing';
import type { CaptureEnginePort } from '@/engine/CaptureEnginePort';
import { ENGINE_SCENARIOS, type ScenarioKit } from '@/engine/contract/engineScenarios';
import type { ServerSays } from '@/engine/contract/serverSays';

/** One engine for one test, the server that answers it, and how to let both go. */
export type EngineUnderTest = {
  readonly engine: CaptureEnginePort;
  say(words: ServerSays): void | Promise<void>;
  /** See `ScenarioKit.ready`: an engine with a meter resolves on its readiness line (review C4a N-3). */
  ready(ready: Partial<Readiness>): void | Promise<void>;
  dispose(): void | Promise<void>;
};

/**
 * Waits until the engine has reported on what was just sent. The fake reports
 * synchronously, so its default waits for nothing; the bridge waits for the ack (CD8).
 */
export type Settle = () => Promise<void>;
const NOTHING: Settle = () => Promise.resolve();

/** The kit's size, so a scenario lost from the list reds here rather than passing unseen (PV12). */
export const ENGINE_SCENARIO_COUNT = 11;

export function describeEngineContract(
  name: string,
  make: () => EngineUnderTest | Promise<EngineUnderTest>,
  settle: Settle = NOTHING,
): void {
  describe(`the engine contract: ${name}`, () => {
    let subject: EngineUnderTest;
    beforeEach(async () => {
      subject = await make();
    });
    afterEach(() => subject.dispose());
    const kit: ScenarioKit = {
      send: async (intent) => {
        subject.engine.send(intent);
        await settle();
      },
      say: async (words) => {
        await subject.say(words);
        await settle();
      },
      ready: async (ready) => {
        await subject.ready(ready);
        await settle();
      },
      snapshot: () => subject.engine.getSnapshot(),
    };
    it(`runs all ${ENGINE_SCENARIO_COUNT} scenarios, each named once`, () => {
      const names = new Set(ENGINE_SCENARIOS.map((scenario) => scenario.name));
      expect([ENGINE_SCENARIOS.length, names.size]).toEqual([
        ENGINE_SCENARIO_COUNT,
        ENGINE_SCENARIO_COUNT,
      ]);
    });
    for (const scenario of ENGINE_SCENARIOS) it(scenario.name, () => scenario.run(kit));
  });
}
