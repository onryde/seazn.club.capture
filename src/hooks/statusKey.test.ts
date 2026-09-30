import { describe, expect, it } from 'vitest';
import type { SessionState } from '@/domain/session/SessionState';
import type { EngineSnapshot, Telemetry } from '@/engine/CaptureEnginePort';
import { IDLE_TELEMETRY } from '@/engine/FakeCaptureEngine';
import {
  selectHoldRemaining,
  selectHoldWindow,
  selectStatusKey,
  viewfinderStatusKey,
} from '@/hooks/statusKey';
import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import { createTranslator } from '@/i18n/translate';

const ARMED_OK: Partial<Telemetry> = { cameraReady: true, networkReachable: true, audioLevel: 0.4 };
const snap = (state: SessionState, telemetry: Partial<Telemetry> = ARMED_OK): EngineSnapshot => ({
  state,
  telemetry: { ...IDLE_TELEMETRY, ...telemetry },
  descriptor: null,
  reportedAtMs: 0,
  survivesBackground: true,
});
const { t } = createTranslator('en');
const line = (s: EngineSnapshot) => t(selectStatusKey(s), { remaining: 38, window: 183 });
const since = 1;
const LIVE: SessionState = { kind: 'publishing', transport: 'srt', sinceEpochMs: since };
const holding = (cause: 'uplink-lost' | 'video-stalled' | 'not-delivered'): SessionState => ({
  kind: 'reconnecting',
  cause,
  holdRemainingSeconds: 38,
  holdWindowSeconds: 183,
  sinceEpochMs: since,
});

describe('the status line (spec §4 and §5)', () => {
  it.each<[string, SessionState, string]>([
    ['holding', holding('uplink-lost'), 'Uplink lost — holding, 38 s of 183'],
    ['the video stalled', holding('video-stalled'), 'Video stalled — restarting, 38 s of 183'],
    [
      'restarting for viewers',
      holding('not-delivered'),
      'Viewers not receiving — restarting, 38 s of 183',
    ],
    [
      'fell back',
      { kind: 'degraded', transport: 'rtmps', reason: 'fell-back-to-rtmps', sinceEpochMs: since },
      'Switched to backup link (RTMPS)',
    ],
    [
      'the uplink is weak',
      { kind: 'degraded', transport: 'srt', reason: 'poor-uplink', sinceEpochMs: since },
      'Weak signal. Still live.',
    ],
    [
      'not delivered',
      { kind: 'degraded', transport: 'srt', reason: 'not-delivered', sinceEpochMs: since },
      'Viewers not receiving — restarting',
    ],
    [
      'camera taken',
      { kind: 'degraded', transport: 'srt', reason: 'camera-taken', sinceEpochMs: since },
      'Camera taken by another app — slate on air',
    ],
    [
      'mic silenced',
      { kind: 'degraded', transport: 'srt', reason: 'mic-silenced', sinceEpochMs: since },
      'Mic silenced by a call',
    ],
    ['idle', { kind: 'idle' }, 'Starting the camera…'],
    ['connecting', { kind: 'connecting', transport: 'srt' }, 'Opening the link.'],
    [
      'the operator stopped',
      { kind: 'ended', reason: 'operator-stopped', durationMs: 754_000 },
      'You stopped the broadcast.',
    ],
    [
      'organiser stop',
      { kind: 'ended', reason: 'stopped-by-organiser', durationMs: 1 },
      'Stopped by the organiser',
    ],
    [
      'the hold ran out',
      { kind: 'ended', reason: 'hold-window-expired', durationMs: 1 },
      'The connection was lost for too long.',
    ],
    [
      'a fatal error',
      { kind: 'ended', reason: 'fatal-error', durationMs: null },
      'Something failed. Your code is kept.',
    ],
  ])('says the spec’s sentence when %s', (_name, state, sentence) => {
    expect(line(snap(state))).toBe(sentence);
  });

  it.each<[string, Partial<Telemetry>, string]>([
    ['no camera', { ...ARMED_OK, cameraReady: false }, 'stream.status.noCamera'],
    ['no network', { ...ARMED_OK, networkReachable: false }, 'stream.status.noNetwork'],
    ['no sound', { ...ARMED_OK, audioLevel: 0.049 }, 'stream.status.noSound'],
    ['sound exactly at the floor', { ...ARMED_OK, audioLevel: 0.05 }, 'stream.status.ready'],
    ['nothing ready, camera first', IDLE_TELEMETRY, 'stream.status.noCamera'],
    [
      'no network and no sound, network first',
      { ...ARMED_OK, networkReachable: false, audioLevel: 0 },
      'stream.status.noNetwork',
    ],
  ])('names the first pre-flight problem when armed: %s', (_name, telemetry, key) => {
    expect(selectStatusKey(snap({ kind: 'armed' }, telemetry))).toBe(key);
  });

  it('says live with no sound when the level is under the floor on air (a display rule, D39)', () => {
    expect(line(snap(LIVE, { ...ARMED_OK, audioLevel: 0.01 }))).toBe(
      'Live with no sound. Check the mic now.',
    );
    expect(line(snap(LIVE))).toBe('Live. Sound and picture going out.');
  });

  it('never lets a failing heartbeat change what it says (ruling 5)', () => {
    const heartbeat = {
      lastSentAtEpochMs: 1,
      lastResult: 'failed' as const,
      consecutiveFailures: 40,
      failures: 40,
    };
    const failing = { ...ARMED_OK, heartbeat };
    expect(selectStatusKey(snap(LIVE, failing))).toBe('stream.status.live');
    expect(selectStatusKey(snap({ kind: 'armed' }, failing))).toBe('stream.status.ready');
  });

  it('never mentions heat, which the top strip owns (AGENTS §8)', () => {
    const hot = { ...ARMED_OK, shed: 'overlay-preview' as const, thermalStatus: 'severe' as const };
    expect(selectStatusKey(snap(LIVE, hot))).toBe('stream.status.live');
  });

  it('reads no missing rate as trouble: native’s state decides (null is no reading)', () => {
    const noReadings: Partial<Telemetry> = {
      ...ARMED_OK,
      bitrateKbps: null,
      encodedVideoFps: null,
      audioPacketsPerSecond: null,
      deliveredLagMs: null,
      delivery: 'unknown',
    };
    expect(selectStatusKey(snap(LIVE, noReadings))).toBe('stream.status.live');
  });
});

/**
 * Carry 8: every wire string plan B's engine can send reaches a sentence.
 * The literals are plan B's `.wire` values, copied by hand: a rename on
 * either side leaves one of them without a line.
 */
describe('every native reason has a line', () => {
  const KEYS = new Set(Object.keys(en));
  it.each(['not-delivered', 'camera-taken', 'mic-silenced', 'poor-uplink', 'fell-back-to-rtmps'])(
    'degraded %s',
    (reason) => {
      const state = { kind: 'degraded', transport: 'srt', reason, sinceEpochMs: 1 };
      expect(KEYS.has(selectStatusKey(snap(state as SessionState)))).toBe(true);
    },
  );
  it.each(['operator-stopped', 'stopped-by-organiser', 'hold-window-expired', 'fatal-error'])(
    'ended %s',
    (reason) => {
      const state = { kind: 'ended', reason, durationMs: null };
      expect(KEYS.has(selectStatusKey(snap(state as SessionState)))).toBe(true);
    },
  );
  it.each(['uplink-lost', 'video-stalled', 'not-delivered'])('reconnecting %s', (cause) => {
    const state = { ...holding('uplink-lost'), cause };
    expect(KEYS.has(selectStatusKey(snap(state as SessionState)))).toBe(true);
  });
});

describe('in every language', () => {
  const fill = (text: string) => text.replace('{remaining}', '38').replace('{window}', '183');
  it.each([
    ['en', en],
    ['es', es],
    ['fr', fr],
    ['nl', nl],
  ] as const)('%s says its own holding line, with both numbers', (lang, dictionary) => {
    const said = createTranslator(lang).t(selectStatusKey(snap(holding('uplink-lost'))), {
      remaining: 38,
      window: 183,
    });
    expect(said).toBe(fill(dictionary['stream.status.holding']));
    expect(said).not.toMatch(/[{}]/);
  });
});

describe('viewfinderStatusKey', () => {
  it('says the code timed out once the warming deadline passes while armed (spec §5, D13)', () => {
    const key = viewfinderStatusKey('stream.status.ready', {
      kind: 'armed',
      unusable: false,
      codeTimedOut: true,
    });
    expect(t(key)).toBe('Code timed out — ask the organiser for a new one');
  });

  it('says a saved code cannot be used before and while arming', () => {
    for (const kind of ['idle', 'armed'] as const) {
      expect(
        viewfinderStatusKey('stream.status.starting', {
          kind,
          unusable: true,
          codeTimedOut: false,
        }),
      ).toBe('stream.status.unusable');
    }
  });

  it('puts an unusable code before a timed-out one: no wait on the phone fixes it', () => {
    expect(
      viewfinderStatusKey('stream.status.ready', {
        kind: 'armed',
        unusable: true,
        codeTimedOut: true,
      }),
    ).toBe('stream.status.unusable');
  });

  it('says nothing of the deadline before the engine is armed', () => {
    expect(
      viewfinderStatusKey('stream.status.starting', {
        kind: 'idle',
        unusable: false,
        codeTimedOut: true,
      }),
    ).toBe('stream.status.starting');
  });

  it('leaves an on-air line alone, whatever the clock says', () => {
    expect(
      viewfinderStatusKey('stream.status.live', {
        kind: 'publishing',
        unusable: true,
        codeTimedOut: true,
      }),
    ).toBe('stream.status.live');
  });

  it('leaves the engine’s line alone when nothing is wrong with the code', () => {
    expect(
      viewfinderStatusKey('stream.status.ready', {
        kind: 'armed',
        unusable: false,
        codeTimedOut: false,
      }),
    ).toBe('stream.status.ready');
  });
});

describe('the hold countdown', () => {
  it('reads native’s remaining and window while reconnecting', () => {
    const s = snap(holding('video-stalled'));
    expect([selectHoldRemaining(s), selectHoldWindow(s)]).toEqual([38, 183]);
  });

  it('is absent otherwise', () => {
    expect([selectHoldRemaining(snap(LIVE)), selectHoldWindow(snap(LIVE))]).toEqual([null, null]);
  });
});
