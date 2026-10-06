import { createFakeCaptureEngine } from './FakeCaptureEngine';
import { describeEngineContract } from '../../../test/engineContract';

// The fake keeps the contract native keeps, so no JS path leans on a leniency
// the bridge does not have. Task 27 runs the same kit against the JVM host.
describeEngineContract('the fake', () => {
  const engine = createFakeCaptureEngine();
  return {
    engine,
    say: (words) => engine.hear(words),
    ready: (ready) => engine.setReady(ready),
    dispose: () => engine.dispose(),
  };
});
