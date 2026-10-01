import { describe, expectTypeOf, it } from 'vitest';
import type { Transport } from '@/domain/credentials/StreamCredentials';
import type {
  DegradeReason,
  EndReason,
  ReconnectCause,
  SessionState,
  ShedStep,
} from '@/domain/session/SessionState';
import type { Delivery, HeartbeatResult, Telemetry } from '@/engine/CaptureEnginePort';

/**
 * Type tests: the `types` vitest project runs this file through `tsc`, so a
 * wrong type fails `pnpm test` as a failed test, not only `pnpm typecheck`.
 */
describe('no reading is null, never zero (plan B reports null off air)', () => {
  it('types every rate native may not have as nullable', () => {
    expectTypeOf<Telemetry['encodedVideoFps']>().toEqualTypeOf<number | null>();
    expectTypeOf<Telemetry['audioPacketsPerSecond']>().toEqualTypeOf<number | null>();
    expectTypeOf<Telemetry['deliveredLagMs']>().toEqualTypeOf<number | null>();
    expectTypeOf<Telemetry['bitrateKbps']>().toEqualTypeOf<number | null>();
    expectTypeOf<Telemetry['targetBitrateKbps']>().toEqualTypeOf<number | null>();
  });
});

/**
 * D40: each union equals plan B's `.wire` strings, copied here by hand from
 * plan B's `Vocabulary.kt`. A rename on the TypeScript side fails here. A
 * rename on the Kotlin side leaves these literals green: that drift is plan
 * C's contract test to catch.
 */
describe('wire strings equal plan B’s (D40)', () => {
  it('pins the state kinds and reasons', () => {
    expectTypeOf<SessionState['kind']>().toEqualTypeOf<
      'idle' | 'armed' | 'connecting' | 'publishing' | 'degraded' | 'reconnecting' | 'ended'
    >();
    expectTypeOf<Exclude<DegradeReason, 'audio-below-floor'>>().toEqualTypeOf<
      'not-delivered' | 'camera-taken' | 'mic-silenced' | 'poor-uplink' | 'fell-back-to-rtmps'
    >();
    expectTypeOf<EndReason>().toEqualTypeOf<
      'operator-stopped' | 'stopped-by-organiser' | 'hold-window-expired' | 'fatal-error'
    >();
    expectTypeOf<ReconnectCause>().toEqualTypeOf<
      'uplink-lost' | 'video-stalled' | 'not-delivered'
    >();
  });

  it('pins delivery, the shed ladder, the transports and the heartbeat results', () => {
    expectTypeOf<Delivery>().toEqualTypeOf<'ok' | 'stalled' | 'unknown'>();
    expectTypeOf<ShedStep>().toEqualTypeOf<'overlay-preview' | 'preview-framerate' | 'encode'>();
    expectTypeOf<Transport>().toEqualTypeOf<'srt' | 'rtmps'>();
    expectTypeOf<HeartbeatResult>().toEqualTypeOf<'ok' | 'failed' | 'session-over'>();
    expectTypeOf<Telemetry['heartbeat']['lastResult']>().toEqualTypeOf<HeartbeatResult | null>();
  });
});
