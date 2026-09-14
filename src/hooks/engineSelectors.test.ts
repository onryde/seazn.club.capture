import { describe, expect, it } from 'vitest';
import { AUDIO_FLOOR } from '@/domain/policy/audioFloor';
import type {
  DegradeReason,
  EndReason,
  SessionState,
} from '@/domain/session/SessionState';
import type { EngineSnapshot, Interruption, Telemetry } from '@/engine/CaptureEnginePort';
import {
  STATUS_LINE_BUDGET,
  selectStatusLine,
  selectTally,
} from '@/hooks/engineSelectors';

const NOW = 1_700_000_000_000;

const telemetry: Telemetry = {
  bitrateKbps: 3000,
  droppedFrames: 0,
  rttMs: 48,
  audioLevel: 0.4,
  thermalHeadroom: 0.7,
  batteryLevel: 0.8,
  captureTimestampMs: NOW,
  shed: null,
  interruption: null,
};

function snapshot(state: SessionState, overrides: Partial<Telemetry> = {}): EngineSnapshot {
  return {
    state,
    telemetry: { ...telemetry, ...overrides },
    credentials: null,
    reportedAtMs: NOW,
    survivesBackground: false,
  };
}

const DEGRADE_REASONS: DegradeReason[] = [
  'fell-back-to-rtmps',
  'poor-uplink',
  'audio-below-floor',
];
const END_REASONS: EndReason[] = ['operator-stopped', 'hold-window-expired', 'fatal-error'];
const INTERRUPTIONS: Interruption[] = ['background', 'call', 'camera-in-use', 'system'];

const EVERY_STATE: SessionState[] = [
  { kind: 'idle' },
  { kind: 'armed' },
  { kind: 'connecting', transport: 'srt' },
  { kind: 'publishing', transport: 'srt', sinceEpochMs: NOW },
  ...DEGRADE_REASONS.map<SessionState>((reason) => ({
    kind: 'degraded',
    transport: 'srt',
    reason,
    sinceEpochMs: NOW,
  })),
  { kind: 'reconnecting', holdRemainingSeconds: 38, sinceEpochMs: NOW },
  ...END_REASONS.map<SessionState>((reason) => ({ kind: 'ended', reason })),
];

describe('selectStatusLine', () => {
  // A StatusLine truncation is silent — no error, no failing render — so the
  // budget has to be asserted or the instruction quietly disappears. This is
  // the test that would have caught "Check it…".
  it.each(EVERY_STATE)('stays inside the copy budget for %o', (state) => {
    const line = selectStatusLine(snapshot(state));

    expect(line.length).toBeLessThanOrEqual(STATUS_LINE_BUDGET);
  });

  it.each(INTERRUPTIONS)('stays inside the copy budget while interrupted by %s', (kind) => {
    const line = selectStatusLine(
      snapshot({ kind: 'publishing', transport: 'srt', sinceEpochMs: NOW }, { interruption: kind }),
    );

    expect(line.length).toBeLessThanOrEqual(STATUS_LINE_BUDGET);
  });

  it.each(EVERY_STATE)('always says something for %o', (state) => {
    expect(selectStatusLine(snapshot(state)).length).toBeGreaterThan(0);
  });

  // An outside interruption outranks the session copy: "Live" would be true
  // about the transport and a lie about the broadcast.
  it('prefers an interruption over the session line', () => {
    const line = selectStatusLine(
      snapshot({ kind: 'publishing', transport: 'srt', sinceEpochMs: NOW }, { interruption: 'call' }),
    );

    expect(line).toContain('call');
  });

  // Thermal state belongs to the stage's edge note, not here. Saying it in
  // both places put the same sentence on screen twice, worded differently.
  it('does not mention thermal state, which the edge note owns', () => {
    const line = selectStatusLine(
      snapshot({ kind: 'publishing', transport: 'srt', sinceEpochMs: NOW }, { shed: 'encode' }),
    );

    expect(line).toBe('Live. Sound and picture going out.');
  });

  // One authority on the audio question: the line and the Go live control must
  // not disagree between 0 and the floor.
  it('agrees with the Go live gate about what counts as sound', () => {
    const justUnder = selectStatusLine(snapshot({ kind: 'armed' }, { audioLevel: AUDIO_FLOOR - 0.01 }));
    const atFloor = selectStatusLine(snapshot({ kind: 'armed' }, { audioLevel: AUDIO_FLOOR }));

    expect(justUnder).toContain('Check the mic');
    expect(atFloor).toContain('Hold to go live');
  });

  it('carries the hold countdown native reports', () => {
    const line = selectStatusLine(
      snapshot({ kind: 'reconnecting', holdRemainingSeconds: 38, sinceEpochMs: NOW }),
    );

    expect(line).toBe('Signal lost. Holding 38s.');
  });
});

describe('selectTally', () => {
  it.each([
    [{ kind: 'idle' } as SessionState, 'idle'],
    [{ kind: 'ended', reason: 'operator-stopped' } as SessionState, 'idle'],
    [{ kind: 'armed' } as SessionState, 'ready'],
    [{ kind: 'publishing', transport: 'srt', sinceEpochMs: NOW } as SessionState, 'live'],
    [
      { kind: 'degraded', transport: 'srt', reason: 'poor-uplink', sinceEpochMs: NOW } as SessionState,
      'trouble',
    ],
    [{ kind: 'reconnecting', holdRemainingSeconds: 9, sinceEpochMs: NOW } as SessionState, 'trouble'],
  ])('maps %o to %s', (state, expected) => {
    expect(selectTally(snapshot(state))).toBe(expected);
  });
});
