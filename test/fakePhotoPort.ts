import type { PhotoOutcome, PhotoPort } from '@/services/photoPort';

export type FakePhotoPort = PhotoPort & {
  readonly calls: number;
  /** Every later take answers with this, until changed. Default `saved`. */
  answerWith(outcome: PhotoOutcome): void;
  /** The next take stays pending until `release`. */
  hold(): void;
  release(outcome?: PhotoOutcome): void;
};

export function createFakePhotoPort(): FakePhotoPort {
  let calls = 0;
  let next: PhotoOutcome = 'saved';
  let holdNext = false;
  let held: ((outcome: PhotoOutcome) => void) | null = null;
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
      const resolve = held;
      held = null;
      resolve?.(outcome ?? next);
    },
    take: () => {
      calls += 1;
      if (!holdNext) return Promise.resolve(next);
      holdNext = false;
      return new Promise<PhotoOutcome>((resolve) => {
        held = resolve;
      });
    },
  };
}
