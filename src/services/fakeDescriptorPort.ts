import { type Result, ok } from '@/domain/Result';
import type { DescriptorError, SessionDescriptor } from '@/domain/credentials/SessionDescriptor';
import type { DescriptorPort } from '@/services/descriptorPort';

type Answer = Result<SessionDescriptor, DescriptorError>;

export const SAMPLE_SID = '5d9c1d0e-0000-4000-8000-000000000001';

/**
 * A made-up descriptor: warming, due to go live within 10 minutes, valid for
 * 4 hours, at a London venue. The same values as test/fixtures/wire.ts.
 */
export function sampleDescriptor(
  now: Date,
  overrides: Partial<SessionDescriptor> = {},
): SessionDescriptor {
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000);
  return {
    sid: SAMPLE_SID,
    state: 'warming',
    endReason: null,
    playbackUrl: 'https://video.example/fake/manifest/video.m3u8',
    overlayUrl: 'https://stg.seazn.club/overlay/fixtures/fake-fixture',
    holdWindowSeconds: { srt: 183, rtmps: 183 },
    venueTimezone: 'Europe/London',
    label: 'Seazn XI v Fake CC',
    scoreUpdates: 'realtime',
    maxDurationMinutes: 300,
    warmingDeadline: at(10),
    expiresAt: at(240),
    heartbeatUrl: 'https://stg.seazn.club/api/capture/sessions/fake/heartbeat',
    ...overrides,
  };
}

export type FakeDescriptorPort = DescriptorPort & {
  /** Queue answers for the next fetches, in order. Unqueued fetches answer the sample for the sid asked. */
  answer(...results: Answer[]): void;
  /** The next fetch waits until the returned release is called. */
  hold(): () => void;
  readonly calls: readonly { readonly sid: string; readonly token: string }[];
};

/** The development build's descriptor too, behind EXPO_PUBLIC_FAKE_DESCRIPTOR (D25). */
export function createFakeDescriptorPort(clock: () => Date): FakeDescriptorPort {
  const queue: Answer[] = [];
  const calls: { sid: string; token: string }[] = [];
  let gate: Promise<void> | null = null;
  return {
    calls,
    answer: (...results) => {
      queue.push(...results);
    },
    hold: () => {
      let release = () => undefined as void;
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => release();
    },
    fetch: async (sid, token) => {
      calls.push({ sid, token });
      const waiting = gate;
      gate = null;
      if (waiting !== null) await waiting;
      return queue.shift() ?? ok(sampleDescriptor(clock(), { sid }));
    },
  };
}
