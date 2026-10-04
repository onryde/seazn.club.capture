import { type Result, ok } from '@/domain/Result';
import type { CodeError, WaitingFields } from '@/domain/credentials/waitingFields';
import type { CodePort } from '@/services/codePort';
import { codeUrl } from '@/services/fetchCodePort';

type Answer = Result<WaitingFields, CodeError>;

/** Made up, 12 characters of the code alphabet (capture-qr.v2). */
export const SAMPLE_CODE = 'fx42hmnp7k2q';

/** Made-up waiting fields on the staging host and the code's D3 paths, for the fake and for tests. */
export function sampleWaiting(overrides: Partial<WaitingFields> = {}): WaitingFields {
  const code = overrides.code ?? SAMPLE_CODE;
  return {
    code,
    label: 'Seazn XI v Fake CC',
    venueTimezone: 'Europe/London',
    scheduledStart: null,
    autoAllowed: true,
    destinationName: 'YouTube · Fake CC',
    overlayUrl: 'https://stg.seazn.club/overlay/fixtures/fake-fixture',
    pollSeconds: 60,
    heartbeatUrl: `${codeUrl('https://stg.seazn.club', code)}/beats`,
    startUrl: `${codeUrl('https://stg.seazn.club', code)}/start`,
    ...overrides,
  };
}

export type FakeCodePort = CodePort & {
  /** Queue answers for the next checks, in order. Unqueued checks answer the sample for the code asked. */
  answer(...results: Answer[]): void;
  /** The next check waits until the returned release is called. */
  hold(): () => void;
  /** Each check's code and slot. The token is never kept, even in a fake. */
  readonly calls: readonly { readonly code: string; readonly slot: number }[];
};

/** The development build's code port too, behind EXPO_PUBLIC_FAKE_CODE. */
export function createFakeCodePort(origin = 'https://stg.seazn.club'): FakeCodePort {
  const queue: Answer[] = [];
  const calls: { code: string; slot: number }[] = [];
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
    check: async ({ code, slot }) => {
      calls.push({ code, slot });
      const waiting = gate;
      gate = null;
      if (waiting !== null) await waiting;
      return queue.shift() ?? ok(sampleWaiting({ code }));
    },
    codeUrl: (code) => codeUrl(origin, code),
  };
}
