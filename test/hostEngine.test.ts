import { describe, expect, it } from 'vitest';
import { HOST_BINARY, startHostEngine } from './hostEngine';

// The one harness guard that needs no JVM, so the domain project runs it on every push.
describe('the host harness, without a host', () => {
  it('says how to build the host when its binary is missing', async () => {
    await expect(startHostEngine(`${HOST_BINARY}-missing`)).rejects.toThrow(
      'build the host first: (cd modules/capture-engine/android/core && ./gradlew :host:installDist)',
    );
  });
});
