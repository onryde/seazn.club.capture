import { createFakeCaptureEngine } from './FakeCaptureEngine';
import { describeEngineContract } from '../../../test/engineContract';

// Fix round 3 (N1): the fake keeps the contract plan B's core sets, so no JS
// path can lean on a leniency native does not have. Plan C runs the same kit
// against the bridge.
describeEngineContract('the fake', () => {
  const engine = createFakeCaptureEngine();
  return { engine, dispose: () => engine.dispose() };
});
