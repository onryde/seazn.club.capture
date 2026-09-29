import { describe, expect, it } from 'vitest';
import { createFakeCodeScanner } from './fakeCodeScanner';

describe('fakeCodeScanner', () => {
  it('returns queued results in order, then cancels', async () => {
    const scanner = createFakeCodeScanner();
    scanner.queue({ outcome: 'scanned', raw: 'a' }, { outcome: 'cancelled' });
    expect(await scanner.scan()).toEqual({ outcome: 'scanned', raw: 'a' });
    expect(await scanner.scan()).toEqual({ outcome: 'cancelled' });
    expect(await scanner.scan()).toEqual({ outcome: 'cancelled' });
    expect(scanner.scans).toBe(3);
  });

  it('holds a deferred scan open until it is finished', async () => {
    const scanner = createFakeCodeScanner();
    const finish = scanner.deferNext();
    const result = scanner.scan();
    finish({ outcome: 'scanned', raw: 'late' });
    expect(await result).toEqual({ outcome: 'scanned', raw: 'late' });
  });

  it('opens a deferred scan once, counts it, then goes back to the queue', async () => {
    const scanner = createFakeCodeScanner();
    const finish = scanner.deferNext();
    const open = scanner.scan();
    finish({ outcome: 'cancelled' });
    await open;
    scanner.queue({ outcome: 'scanned', raw: 'next' });
    expect(await scanner.scan()).toEqual({ outcome: 'scanned', raw: 'next' });
    expect(scanner.scans).toBe(2);
  });

  it('counts prepare intents', () => {
    const scanner = createFakeCodeScanner();
    scanner.prepare();
    scanner.prepare();
    expect(scanner.prepared).toBe(2);
  });
});
