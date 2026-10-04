import type { SavedCode } from '@/domain/mode/savedCode';
import type { FakeCaptureEngine } from '@/engine/FakeCaptureEngine';
import { pairIntentFor } from '@/hooks/usePairing';

/** Pairs the fake with a saved code, as a scan would have: native already holds it. */
export function pairCode(engine: FakeCaptureEngine, saved: SavedCode): void {
  const intent = pairIntentFor(saved, {
    language: 'en',
    automatic: true,
    environment: 'staging',
    claim: 'new',
  });
  if (intent === null) throw new Error('the fixture must be usable');
  engine.send(intent);
}
