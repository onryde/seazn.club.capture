import { describe, expect, it } from 'vitest';
import type { EngineStatus } from '@/domain/mode/reopen';
import type { SessionState } from '@/domain/session/SessionState';
import type { BroadcastInfo, PairingInfo } from '@/domain/session/Pairing';
import type { EngineSnapshot, Telemetry } from '@/engine/CaptureEnginePort';
import { FAKE_PAIRING } from '@/engine/FakeCaptureEngine';
import { IDLE_TELEMETRY } from '@/engine/unreported';
import {
  METER_SEGMENTS,
  selectBitrateKbps,
  selectEngineStatus,
  selectHasPairing,
  selectHeldCode,
  selectHeldName,
  selectHeldSlot,
  selectHeldTokenTag,
  selectAutomaticOn,
  selectDestination,
  selectEndReason,
  selectHoldsOrientation,
  selectLabel,
  selectMeterSegments,
  selectOverlayUrl,
  selectPlaybackUrl,
  selectScheduledStartMs,
  selectVenueZone,
} from '@/hooks/engineSelectors';
import { NO_NAME } from '@/domain/mode/codeName';

const NOW = 1_700_000_000_000;

function snapshot(
  state: SessionState,
  overrides: Partial<Telemetry> = {},
  held: { pairing?: PairingInfo | null; broadcast?: BroadcastInfo | null } = {},
): EngineSnapshot {
  return {
    state,
    telemetry: { ...IDLE_TELEMETRY, ...overrides },
    pairing: held.pairing ?? null,
    broadcast: held.broadcast ?? null,
    ready: { camera: true, sound: true, network: true, held: true },
    refusal: null,
    lastEnd: null,
    unpaired: null,
    codeEndedPending: false,
    // Plan B's `Snapshot.camera`: our own with a pairing, none without one.
    camera: state.kind === 'idle' || state.kind === 'ended' ? null : 'own',
    reportedAtMs: NOW,
    survivesBackground: false,
  };
}

const LIVE: SessionState = { kind: 'publishing', transport: 'srt', sinceEpochMs: NOW };
const PAIRING: SessionState = { kind: 'pairing' };
const PAIRED: SessionState = { kind: 'paired' };
const ARMING: SessionState = { kind: 'arming', cause: 'organiser', retrying: false };
const ARMED: SessionState = { kind: 'armed', cause: 'operator', notReady: 'sound' };

describe('selectEngineStatus', () => {
  it.each<[SessionState, EngineStatus]>([
    [{ kind: 'idle' }, 'idle'],
    [PAIRING, 'paired'],
    [PAIRED, 'paired'],
    // A broadcast held, never a pairing to unpair or a code to adopt.
    [ARMING, 'live'],
    [ARMED, 'live'],
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
    [{ kind: 'ended', reason: 'operator-stopped', durationMs: 1 }, 'stopped'],
    [{ kind: 'ended', reason: 'fatal-error', durationMs: null }, 'failed'],
  ])('%j is %s', (state, status) => {
    expect(selectEngineStatus(snapshot(state))).toBe(status);
  });
});

describe('selectHoldsOrientation', () => {
  it.each<[SessionState, boolean]>([
    [{ kind: 'idle' }, false],
    // CD37: the camera is open while paired, so the lock holds from Pairing on.
    [PAIRING, true],
    [PAIRED, true],
    [ARMING, true],
    [ARMED, true],
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

const BROADCAST: BroadcastInfo = {
  sid: 'fake-sid-1',
  cause: 'operator',
  playbackUrl: 'https://video.example/fake/manifest/video.m3u8',
  overlayUrl: 'https://stg.seazn.club/overlay/fixtures/broadcast',
  label: 'Seazn XI v Fake CC (broadcast)',
  holdWindowSeconds: { srt: 183, rtmps: 183 },
  maxDurationMinutes: 300,
  scoreUpdates: 'polled',
  srtOffered: true,
};

describe('the pairing and broadcast selectors (D8: the snapshot carries no secret)', () => {
  it('read the pairing alone while paired', () => {
    const paired = snapshot(PAIRED, {}, { pairing: FAKE_PAIRING });
    expect({
      overlay: selectOverlayUrl(paired),
      playback: selectPlaybackUrl(paired),
      label: selectLabel(paired),
      zone: selectVenueZone(paired),
      has: selectHasPairing(paired),
    }).toEqual({
      overlay: 'https://stg.seazn.club/overlay/fixtures/fx42hmnp7k2q',
      playback: null,
      label: 'Seazn XI v Fake CC',
      zone: 'Europe/London',
      has: true,
    });
  });

  it('read the broadcast over the pairing while one is held', () => {
    const live = snapshot(LIVE, {}, { pairing: FAKE_PAIRING, broadcast: BROADCAST });
    expect({
      overlay: selectOverlayUrl(live),
      playback: selectPlaybackUrl(live),
      label: selectLabel(live),
    }).toEqual({
      overlay: 'https://stg.seazn.club/overlay/fixtures/broadcast',
      playback: 'https://video.example/fake/manifest/video.m3u8',
      label: 'Seazn XI v Fake CC (broadcast)',
    });
  });

  it('read null with nothing held', () => {
    const idle = snapshot({ kind: 'idle' });
    expect([
      selectOverlayUrl(idle),
      selectPlaybackUrl(idle),
      selectLabel(idle),
      selectVenueZone(idle),
      selectHasPairing(idle),
    ]).toEqual([null, null, null, null, false]);
  });

  it('read an empty label or zone (a claim not yet answered) as none', () => {
    const pairing = { ...FAKE_PAIRING, label: '', venueTimezone: '' };
    const early = snapshot(PAIRING, {}, { pairing });
    expect([selectLabel(early), selectVenueZone(early)]).toEqual([null, null]);
  });

  it('fall back to the pairing overlay when the broadcast sent none', () => {
    const live = snapshot(
      LIVE,
      {},
      { pairing: FAKE_PAIRING, broadcast: { ...BROADCAST, overlayUrl: null } },
    );
    expect(selectOverlayUrl(live)).toBe('https://stg.seazn.club/overlay/fixtures/fx42hmnp7k2q');
  });
});

describe('the held name (amendment, Identity rules)', () => {
  it('reads the pairing three ways, each a stable scalar, and once whole', () => {
    const paired = snapshot(PAIRED, {}, { pairing: FAKE_PAIRING });
    expect([selectHeldCode(paired), selectHeldSlot(paired), selectHeldTokenTag(paired)]).toEqual([
      'fx42hmnp7k2q',
      1,
      'b24bb97b',
    ]);
    expect(selectHeldName(paired)).toEqual({ code: 'fx42hmnp7k2q', slot: 1, tokenTag: 'b24bb97b' });
  });

  it('names nothing with no pairing', () => {
    const idle = snapshot({ kind: 'idle' });
    expect([selectHeldCode(idle), selectHeldSlot(idle), selectHeldTokenTag(idle)]).toEqual([
      null,
      null,
      null,
    ]);
    expect(selectHeldName(idle)).toBe(NO_NAME);
  });
});

/** Amendment §2, Viewfinder paired: what the column shows beside the chips. */
describe('the waiting fields the viewfinder shows (Task 28)', () => {
  const withPairing = (change: Partial<PairingInfo>) =>
    snapshot(PAIRED, {}, { pairing: { ...FAKE_PAIRING, ...change } });

  it('reads the scheduled start as epoch ms, a primitive, or null with none', () => {
    const at = new Date('2026-10-03T13:30:00Z');
    expect(selectScheduledStartMs(withPairing({ scheduledStart: at }))).toBe(1_791_034_200_000);
    expect(selectScheduledStartMs(withPairing({ scheduledStart: null }))).toBeNull();
    expect(selectScheduledStartMs(snapshot({ kind: 'idle' }))).toBeNull();
  });

  // A4: AUTO shows only when automatic mode is on at both ends.
  it.each<[boolean, boolean, boolean]>([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])('AUTO with the organiser’s %s and the phone’s %s: %s', (autoAllowed, automatic, on) => {
    expect(selectAutomaticOn(withPairing({ autoAllowed, automatic }))).toBe(on);
  });

  it('shows no AUTO with no pairing', () => {
    expect(selectAutomaticOn(snapshot({ kind: 'idle' }))).toBe(false);
  });

  it('reads the destination’s name, an empty one as none, and none with no pairing', () => {
    expect(selectDestination(withPairing({ destinationName: 'YouTube · Fake CC' }))).toBe(
      'YouTube · Fake CC',
    );
    expect(selectDestination(withPairing({ destinationName: null }))).toBeNull();
    expect(selectDestination(withPairing({ destinationName: '' }))).toBeNull();
    expect(selectDestination(snapshot({ kind: 'idle' }))).toBeNull();
  });

  it('reads how a session ended only once it has', () => {
    expect([
      selectEndReason(snapshot({ kind: 'ended', reason: 'operator-stopped', durationMs: 1 })),
      selectEndReason(snapshot({ kind: 'ended', reason: 'fatal-error', durationMs: null })),
      selectEndReason(snapshot(LIVE)),
      selectEndReason(snapshot(PAIRED)),
    ]).toEqual(['operator-stopped', 'fatal-error', null, null]);
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
