import { describe, expect, it, vi } from 'vitest';
import { createFakeRealtimePort } from '@/services/fakeRealtimePort';
import type { RealtimeGrant } from '@/services/scoringPort';

// Made up, as the fake scoring port's own grant is.
const GRANT: RealtimeGrant = {
  token: 'fake-realtime-token',
  channel: 'fixture:fake-fixture',
  url: 'https://fake.supabase.example',
  apikey: 'fake-anon-key',
};

const handlers = () => ({ onPing: vi.fn(), onDown: vi.fn(), onUp: vi.fn() });

describe('the fake Realtime port', () => {
  it('says nothing until a control is used, and never from inside subscribe', () => {
    const fake = createFakeRealtimePort();
    const h = handlers();
    fake.subscribe(GRANT, h);
    expect(h.onPing).not.toHaveBeenCalled();
    expect(h.onUp).not.toHaveBeenCalled();
    expect(h.onDown).not.toHaveBeenCalled();
  });

  it('ping reaches the subscription with no payload', () => {
    const fake = createFakeRealtimePort();
    const h = handlers();
    fake.subscribe(GRANT, h);
    fake.ping();
    expect(h.onPing).toHaveBeenCalledTimes(1);
    expect(h.onPing).toHaveBeenCalledWith();
  });

  it('drop is down and restore is up, each said once per change like the real port', () => {
    const fake = createFakeRealtimePort();
    const h = handlers();
    fake.subscribe(GRANT, h);
    fake.restore();
    fake.restore();
    fake.drop();
    fake.drop();
    fake.restore();
    expect(h.onUp).toHaveBeenCalledTimes(2);
    expect(h.onDown).toHaveBeenCalledTimes(1);
  });

  it('a drop before any restore is down: a channel that never joined', () => {
    const fake = createFakeRealtimePort();
    const h = handlers();
    fake.subscribe(GRANT, h);
    fake.drop();
    expect(h.onDown).toHaveBeenCalledTimes(1);
  });

  it('the controls are nothing while nobody is subscribed, and after the unsubscribe', () => {
    const fake = createFakeRealtimePort();
    expect(() => {
      fake.ping();
      fake.drop();
      fake.restore();
    }).not.toThrow();
    const h = handlers();
    const off = fake.subscribe(GRANT, h);
    off();
    off();
    fake.ping();
    fake.drop();
    fake.restore();
    expect(h.onPing).not.toHaveBeenCalled();
    expect(h.onDown).not.toHaveBeenCalled();
    expect(h.onUp).not.toHaveBeenCalled();
  });

  it('one subscription at a time: a second closes the first, and the controls act on the second', () => {
    const fake = createFakeRealtimePort();
    const first = handlers();
    const second = handlers();
    fake.subscribe(GRANT, first);
    fake.subscribe({ ...GRANT, token: 'second-token' }, second);
    fake.ping();
    fake.drop();
    expect(first.onPing).not.toHaveBeenCalled();
    expect(first.onDown).not.toHaveBeenCalled();
    expect(second.onPing).toHaveBeenCalledTimes(1);
    expect(second.onDown).toHaveBeenCalledTimes(1);
  });

  it('keeps each grant it was given, and which of them is still open', () => {
    const fake = createFakeRealtimePort();
    const offFirst = fake.subscribe(GRANT, handlers());
    expect(fake.subscriptions).toEqual([{ grant: GRANT, open: true }]);
    const fresh = { ...GRANT, token: 'fresh-token' };
    fake.subscribe(fresh, handlers());
    expect(fake.subscriptions).toEqual([
      { grant: GRANT, open: false },
      { grant: fresh, open: true },
    ]);
    offFirst();
    expect(fake.subscriptions.map((entry) => entry.open)).toEqual([false, true]);
  });
});
