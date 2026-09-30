import { describe, expect, it } from 'vitest';
import { err } from '@/domain/Result';
import { createFakeDescriptorPort } from '@/services/fakeDescriptorPort';

const NOW = new Date('2026-10-03T13:00:00Z');

describe('the fake descriptor port', () => {
  it('answers the sample for the sid it was asked about', async () => {
    const port = createFakeDescriptorPort(() => NOW);
    const answer = await port.fetch('other-sid', 't');
    expect(answer).toMatchObject({
      ok: true,
      value: { sid: 'other-sid', venueTimezone: 'Europe/London' },
    });
    expect(port.calls).toEqual([{ sid: 'other-sid', token: 't' }]);
  });

  it('plays queued answers in order, then the sample', async () => {
    const port = createFakeDescriptorPort(() => NOW);
    port.answer(err({ kind: 'offline' }), err({ kind: 'not-found' }));
    expect((await port.fetch('s', 't')).ok).toBe(false);
    expect(await port.fetch('s', 't')).toEqual({ ok: false, error: { kind: 'not-found' } });
    expect((await port.fetch('s', 't')).ok).toBe(true);
  });

  it('holds the next fetch until released', async () => {
    const port = createFakeDescriptorPort(() => NOW);
    const release = port.hold();
    let settled = false;
    const pending = port.fetch('s', 't').then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await pending;
    expect(settled).toBe(true);
  });

  it('holds only the next fetch: the one after answers at once', async () => {
    const port = createFakeDescriptorPort(() => NOW);
    const release = port.hold();
    const held = port.fetch('s', 't');
    expect((await port.fetch('s', 't')).ok).toBe(true);
    release();
    expect((await held).ok).toBe(true);
  });
});
