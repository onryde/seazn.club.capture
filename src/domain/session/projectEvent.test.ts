import { describe, expect, it } from 'vitest';
import { projectEvent } from '@/domain/session/projectEvent';
import type { SessionState } from '@/domain/session/SessionState';

const START = 1_000_000;
const idle: SessionState = { kind: 'idle' };
const armed: SessionState = { kind: 'armed' };

const publishing = projectEvent(idle, { kind: 'PublishStarted', transport: 'srt' }, START);

describe('projectEvent', () => {
  it('records when publishing began', () => {
    expect(publishing).toEqual({ kind: 'publishing', transport: 'srt', sinceEpochMs: START });
  });

  it('keeps publishing on the same transport when quality degrades', () => {
    const degraded = projectEvent(
      publishing,
      { kind: 'TransportDegraded', reason: 'poor-uplink' },
      START + 5_000,
    );

    expect(degraded).toEqual({
      kind: 'degraded',
      transport: 'srt',
      reason: 'poor-uplink',
      sinceEpochMs: START,
    });
  });

  it('switches transport on fallback', () => {
    const fellBack = projectEvent(publishing, { kind: 'FellBackToRtmps' }, START + 5_000);

    expect(fellBack).toMatchObject({ transport: 'rtmps', reason: 'fell-back-to-rtmps' });
  });

  // Only a live broadcast can be degraded. Fabricating a transport that was
  // never connected would put the session into a publishing sub-state with no
  // stream behind it.
  it('ignores transport trouble reported before anything is publishing', () => {
    expect(projectEvent(armed, { kind: 'TransportDegraded', reason: 'poor-uplink' }, START)).toBe(
      armed,
    );
    expect(projectEvent(armed, { kind: 'FellBackToRtmps' }, START)).toBe(armed);
  });

  // A hot handset is a device condition, not a damaged broadcast — the ladder
  // sheds the overlay preview long before it touches the encode.
  it('does not move the session when the thermal ceiling is hit', () => {
    expect(projectEvent(publishing, { kind: 'ThermalCeilingHit', shed: 'encode' }, START)).toBe(
      publishing,
    );
    expect(
      projectEvent(armed, { kind: 'ThermalCeilingHit', shed: 'overlay-preview' }, START),
    ).toBe(armed);
  });

  // The property the front door exists for: the broadcast is continuous across
  // a drop, so the operator's elapsed clock must not reset when they walk
  // behind a sightscreen.
  it('preserves elapsed time across a drop and resume', () => {
    const lost = projectEvent(
      publishing,
      { kind: 'UplinkLost', holdWindowSeconds: 60 },
      START + 9_000,
    );
    const resumed = projectEvent(lost, { kind: 'PublishResumed', transport: 'srt' }, START + 30_000);

    expect(lost).toMatchObject({ kind: 'reconnecting', sinceEpochMs: START });
    expect(resumed).toEqual({ kind: 'publishing', transport: 'srt', sinceEpochMs: START });
  });

  it('counts the hold window down while reconnecting', () => {
    const lost = projectEvent(publishing, { kind: 'UplinkLost', holdWindowSeconds: 60 }, START);
    const ticked = projectEvent(
      lost,
      { kind: 'HoldTicked', holdRemainingSeconds: 38 },
      START + 22_000,
    );

    expect(ticked).toMatchObject({ kind: 'reconnecting', holdRemainingSeconds: 38 });
  });

  it('ignores a hold tick that arrives when not reconnecting', () => {
    expect(projectEvent(publishing, { kind: 'HoldTicked', holdRemainingSeconds: 5 }, START)).toBe(
      publishing,
    );
  });

  it('ends the session with a reason', () => {
    const ended = projectEvent(
      publishing,
      { kind: 'SessionEnded', reason: 'hold-window-expired' },
      START,
    );

    expect(ended).toEqual({ kind: 'ended', reason: 'hold-window-expired' });
  });
});
