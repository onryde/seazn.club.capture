import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PHOTO_NOTICE_MS, usePhoto } from '@/hooks/usePhoto';
import { createFakePorts, readRecord, TEST_NOW } from '../../test/fakePorts';
import { wrapperFor } from '../../test/renderWithPorts';

function setup() {
  const fakes = createFakePorts();
  const view = renderHook(() => usePhoto(), { wrapper: wrapperFor(fakes) });
  return { fakes, view };
}
const tap = (view: ReturnType<typeof setup>['view']) =>
  act(async () => {
    view.result.current.take();
  });

describe('usePhoto (spec §8)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves, says so for 3 s, then clears the line', async () => {
    const { fakes, view } = setup();
    expect(PHOTO_NOTICE_MS).toBe(3_000);
    await tap(view);
    expect(fakes.photo.calls).toBe(1);
    expect(view.result.current.notice).toBe('saved');
    act(() => vi.advanceTimersByTime(2_999));
    expect(view.result.current.notice).toBe('saved');
    act(() => vi.advanceTimersByTime(1));
    expect(view.result.current.notice).toBeNull();
  });

  it('says a failure too', async () => {
    const { fakes, view } = setup();
    fakes.photo.answerWith('failed');
    await tap(view);
    expect(view.result.current.notice).toBe('failed');
  });

  it('M15 a tap while a photo is saving does nothing, and the next one after the answer goes through', async () => {
    const { fakes, view } = setup();
    fakes.photo.hold();
    await tap(view);
    await tap(view);
    expect(fakes.photo.calls).toBe(1);
    expect(view.result.current.notice).toBeNull();
    await act(async () => fakes.photo.release('saved'));
    await tap(view);
    expect(fakes.photo.calls).toBe(2);
  });

  it('M16 a second photo inside the 3 s gets its own 3 s, not what is left of the first', async () => {
    const { fakes, view } = setup();
    await tap(view); // saved at 0; its line would clear at 3 000
    act(() => vi.advanceTimersByTime(2_000));
    fakes.photo.answerWith('failed');
    await tap(view); // failed at 2 000; its line is due at 5 000
    act(() => vi.advanceTimersByTime(2_999)); // 4 999: past the first photo's 3 000
    expect(view.result.current.notice).toBe('failed');
    act(() => vi.advanceTimersByTime(1));
    expect(view.result.current.notice).toBeNull();
  });

  it('M22 unmounted while its line shows, it leaves no timer behind', async () => {
    const { fakes, view } = setup();
    // The fake engine's heartbeat is the one timer a fresh set of ports has; stop it so the count is the line's alone.
    fakes.engine.dispose();
    expect(vi.getTimerCount()).toBe(0);
    await tap(view);
    expect(view.result.current.notice).toBe('saved');
    // The positive pair: the line's 3 s timer is armed.
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('writes one record line with a word and a duration, and nothing else', async () => {
    const { fakes, view } = setup();
    fakes.photo.hold();
    await tap(view);
    fakes.setNow(new Date(TEST_NOW.getTime() + 250));
    await act(async () => fakes.photo.release('saved'));
    const lines = readRecord(fakes.record).filter((line) => line.event === 'photo.result');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields).toEqual({ result: 'saved', ms: 250 });
  });
});
