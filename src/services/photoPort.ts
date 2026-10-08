/**
 * Spec §8 and Q2: a still to the gallery. One bounded request whose answer is one of two words. It carries no
 * session state and is never read by the engine. One of the two calls that answer (the other is the scoring link;
 * AGENTS §2, recorded).
 */
export type PhotoOutcome = 'saved' | 'failed';

/** The last resort. Native cuts its own call off at 2 000 ms, so this is normally never heard. */
export const PHOTO_DEADLINE_MS = 4_000;

export interface PhotoPort {
  /** Never rejects and never takes longer than the deadline. */
  take(): Promise<PhotoOutcome>;
}

/** Anything native did not say, in the word it says, is a failure. */
export function readOutcome(value: unknown): PhotoOutcome {
  return value === 'saved' ? 'saved' : 'failed';
}

export function createPhotoPort(call: (() => Promise<unknown>) | null): PhotoPort {
  if (call === null) return { take: () => Promise.resolve('failed') };
  return {
    take: () =>
      new Promise<PhotoOutcome>((resolve) => {
        const timer = setTimeout(() => resolve('failed'), PHOTO_DEADLINE_MS);
        const done = (outcome: PhotoOutcome) => {
          clearTimeout(timer);
          resolve(outcome);
        };
        try {
          call().then(
            (value) => done(readOutcome(value)),
            () => done('failed'),
          );
        } catch {
          done('failed');
        }
      }),
  };
}
