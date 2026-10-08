import type { ScoringLinkOutcome, ScoringLinkPort } from '@/services/scoringLinkPort';

/** Made up: the contract's shape (`dl_` and 43 base64url characters). Never a real link. */
export const FAKE_SCORING_SECRET = 'dl_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-AbCdE';
export const FAKE_SCORING_URL = `https://stg.seazn.club/score/${FAKE_SCORING_SECRET}`;

export type FakeScoringLinkPort = ScoringLinkPort & {
  readonly calls: number;
  /** Every later request answers with this, until changed. Default: ok, with FAKE_SCORING_URL. */
  answerWith(outcome: ScoringLinkOutcome): void;
  /** The next request stays pending until `release`. */
  hold(): void;
  /** Resolves the oldest held request, with [outcome] or, by default, the current answer. */
  release(outcome?: ScoringLinkOutcome): void;
};

export function createFakeScoringLinkPort(): FakeScoringLinkPort {
  let calls = 0;
  let next: ScoringLinkOutcome = { kind: 'ok', url: FAKE_SCORING_URL };
  let holdNext = false;
  const held: ((outcome: ScoringLinkOutcome) => void)[] = [];
  return {
    get calls() {
      return calls;
    },
    answerWith: (outcome) => {
      next = outcome;
    },
    hold: () => {
      holdNext = true;
    },
    release: (outcome) => {
      held.shift()?.(outcome ?? next);
    },
    request: () => {
      calls += 1;
      if (!holdNext) return Promise.resolve(next);
      holdNext = false;
      return new Promise<ScoringLinkOutcome>((resolve) => held.push(resolve));
    },
  };
}
