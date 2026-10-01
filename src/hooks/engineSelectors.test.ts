import { describe, expect, it } from 'vitest';
import type { EngineStatus } from '@/domain/mode/reopen';
import type { SessionState } from '@/domain/session/SessionState';
import type { EngineSnapshot, Telemetry } from '@/engine/CaptureEnginePort';
import { IDLE_TELEMETRY } from '@/engine/FakeCaptureEngine';
import {
  METER_SEGMENTS,
  selectBitrateKbps,
  selectEngineStatus,
  selectHoldsOrientation,
  selectIsOnAir,
  selectLabel,
  selectMeterSegments,
  selectOverlayUrl,
  selectPlaybackUrl,
  selectScoreUpdates,
  selectOnAirPhase,
  selectWarmingDeadlineMs,
} from '@/hooks/engineSelectors';
import { streamSession } from '../../test/fixtures/session';

const NOW = 1_700_000_000_000;

function snapshot(
  state: SessionState,
  overrides: Partial<Telemetry> = {},
  descriptor: EngineSnapshot['descriptor'] = null,
): EngineSnapshot {
  return {
    state,
    telemetry: { ...IDLE_TELEMETRY, ...overrides },
    descriptor,
    slot: null,
    // Plan B's `Snapshot.camera`: our own with a session, none without one.
    camera: state.kind === 'idle' || state.kind === 'ended' ? null : 'own',
    reportedAtMs: NOW,
    survivesBackground: false,
  };
}

const LIVE: SessionState = { kind: 'publishing', transport: 'srt', sinceEpochMs: NOW };

describe('selectOnAirPhase (a phase, not a colour: connecting is on air, its plate is not red)', () => {
  it.each([
    [{ kind: 'idle' } as SessionState, 'idle'],
    [{ kind: 'ended', reason: 'operator-stopped', durationMs: null } as SessionState, 'idle'],
    [{ kind: 'armed' } as SessionState, 'ready'],
    [{ kind: 'connecting', transport: 'srt' } as SessionState, 'live'],
    [LIVE, 'live'],
    [
      {
        kind: 'degraded',
        transport: 'srt',
        reason: 'poor-uplink',
        sinceEpochMs: NOW,
      } as SessionState,
      'trouble',
    ],
    [
      {
        kind: 'reconnecting',
        cause: 'uplink-lost',
        holdRemainingSeconds: 9,
        holdWindowSeconds: 183,
        sinceEpochMs: NOW,
      } as SessionState,
      'trouble',
    ],
  ])('maps %o to %s', (state, expected) => {
    expect(selectOnAirPhase(snapshot(state))).toBe(expected);
  });
});

describe('selectIsOnAir (something is going out, or the app is fighting to keep it going)', () => {
  it.each<[SessionState, boolean]>([
    [{ kind: 'idle' }, false],
    [{ kind: 'armed' }, false],
    [{ kind: 'connecting', transport: 'srt' }, true],
    [LIVE, true],
    [{ kind: 'degraded', transport: 'rtmps', reason: 'poor-uplink', sinceEpochMs: 1 }, true],
    [
      {
        kind: 'reconnecting',
        cause: 'uplink-lost',
        holdRemainingSeconds: 30,
        holdWindowSeconds: 183,
        sinceEpochMs: 1,
      },
      true,
    ],
    [{ kind: 'ended', reason: 'operator-stopped', durationMs: null }, false],
  ])('%j is on air: %s', (state, onAir) => {
    expect(selectIsOnAir(snapshot(state))).toBe(onAir);
  });
});

describe('selectEngineStatus', () => {
  it.each<[SessionState, EngineStatus]>([
    [{ kind: 'idle' }, 'idle'],
    [{ kind: 'armed' }, 'armed'],
    [{ kind: 'connecting', transport: 'srt' }, 'live'],
    [{ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 }, 'live'],
    [{ kind: 'degraded', transport: 'rtmps', reason: 'poor-uplink', sinceEpochMs: 1 }, 'live'],
    [
      {
        kind: 'reconnecting',
        cause: 'uplink-lost',
        holdRemainingSeconds: 30,
        holdWindowSeconds: 183,
        sinceEpochMs: 1,
      },
      'live',
    ],
    [{ kind: 'ended', reason: 'operator-stopped', durationMs: null }, 'stopped'],
    [{ kind: 'ended', reason: 'stopped-by-organiser', durationMs: 1 }, 'stopped'],
    [{ kind: 'ended', reason: 'hold-window-expired', durationMs: null }, 'failed'],
    [{ kind: 'ended', reason: 'fatal-error', durationMs: null }, 'failed'],
  ])('%j is %s', (state, status) => {
    expect(selectEngineStatus(snapshot(state))).toBe(status);
  });
});

describe('selectHoldsOrientation', () => {
  it.each<[SessionState, boolean]>([
    [{ kind: 'idle' }, false],
    [{ kind: 'armed' }, true],
    [{ kind: 'connecting', transport: 'srt' }, true],
    [{ kind: 'publishing', transport: 'srt', sinceEpochMs: 1 }, true],
    [{ kind: 'degraded', transport: 'rtmps', reason: 'poor-uplink', sinceEpochMs: 1 }, true],
    [
      {
        kind: 'reconnecting',
        cause: 'video-stalled',
        holdRemainingSeconds: 30,
        holdWindowSeconds: 183,
        sinceEpochMs: 1,
      },
      true,
    ],
    [{ kind: 'ended', reason: 'operator-stopped', durationMs: null }, false],
    [{ kind: 'ended', reason: 'fatal-error', durationMs: null }, false],
  ])('%j holds the lock: %s', (state, holds) => {
    expect(selectHoldsOrientation(snapshot(state))).toBe(holds);
  });
});

describe('the descriptor selectors (D8: the snapshot carries the descriptor, never a secret)', () => {
  const session = streamSession();
  const armed = snapshot({ kind: 'armed' }, {}, session.descriptor);

  it('read what the session was armed with', () => {
    expect({
      overlay: selectOverlayUrl(armed),
      playback: selectPlaybackUrl(armed),
      scoreUpdates: selectScoreUpdates(armed),
      label: selectLabel(armed),
      deadline: selectWarmingDeadlineMs(armed),
    }).toEqual({
      overlay: 'https://stg.seazn.club/overlay/fixtures/fake-fixture',
      playback: 'https://video.example/fake/manifest/video.m3u8',
      scoreUpdates: 'realtime',
      label: 'Seazn XI v Fake CC',
      deadline: Date.parse('2026-10-03T13:10:00Z'),
    });
  });

  it('read null before an arm', () => {
    const idle = snapshot({ kind: 'idle' });
    expect([
      selectOverlayUrl(idle),
      selectPlaybackUrl(idle),
      selectScoreUpdates(idle),
      selectLabel(idle),
      selectWarmingDeadlineMs(idle),
    ]).toEqual([null, null, null, null, null]);
  });

  it('read no overlay when the server sent a /relay one (carried as null)', () => {
    const relay = streamSession({
      overlayUrl: 'https://stg.seazn.club/overlay/fixtures/fake-fixture/relay',
    });
    expect(relay.descriptor.overlayUrl).toBeNull();
    expect(selectOverlayUrl(snapshot({ kind: 'armed' }, {}, relay.descriptor))).toBeNull();
  });

  it('give the same deadline number on every tick, so a 1 Hz report re-renders nothing', () => {
    const later = { ...armed, reportedAtMs: NOW + 1000 };
    expect(Object.is(selectWarmingDeadlineMs(armed), selectWarmingDeadlineMs(later))).toBe(true);
  });
});

describe('no reading is null, never zero (plan B reports null off air)', () => {
  it('passes a null egress through', () => {
    expect(selectBitrateKbps(snapshot(LIVE, { bitrateKbps: null }))).toBeNull();
    expect(selectBitrateKbps(snapshot(LIVE, { bitrateKbps: 2840 }))).toBe(2840);
  });
});

/**
 * Spec §4: six segments, orange below the floor. A segment lights once the
 * level reaches into its sixth of 0..1, so any sound at all shows: with
 * AUDIO_FLOOR at 0.05, a faint mic is one (orange) segment, never an empty
 * meter beside a green sound chip.
 */
describe('selectMeterSegments', () => {
  it('has six segments', () => {
    expect(METER_SEGMENTS).toBe(6);
  });

  it.each([
    [0, 0],
    [0.01, 1],
    [0.05, 1],
    [0.16, 1],
    [0.17, 2],
    [0.42, 3],
    [0.99, 6],
    [1, 6],
    [1.5, 6],
    [-1, 0],
    [Number.NaN, 0],
  ])('level %d lights %i', (audioLevel, lit) => {
    expect(selectMeterSegments(snapshot(LIVE, { audioLevel }))).toBe(lit);
  });
});
