import type { EngineIntent } from '@/engine/CaptureEnginePort';
import type { FakeCaptureEngine } from '@/engine/FakeCaptureEngine';

/**
 * Native that has not answered yet: intents of the named kinds are held, and
 * not seen by the fake, until `release`, so a test can see the screen between
 * an intent and the snapshot that answers it. Wrap `release` in `act`.
 */
export function holdIntents(engine: FakeCaptureEngine, kinds: readonly EngineIntent['kind'][]) {
  const deliver = engine.send;
  const held: EngineIntent[] = [];
  engine.send = (intent) => {
    if (kinds.includes(intent.kind)) held.push(intent);
    else deliver(intent);
  };
  return {
    held: () => held.map((intent) => intent.kind),
    release: () => {
      engine.send = deliver;
      held.splice(0).forEach(deliver);
    },
  };
}
