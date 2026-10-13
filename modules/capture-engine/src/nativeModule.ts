import { requireOptionalNativeModule } from 'expo';

export type Subscription = { remove(): void };

/**
 * One line of native's record and its seq (carry C4c-I3): the process's n-th line is seq n, so a
 * line the tail already holds is known by its number, never by its text.
 */
export type RecordLine = { seq: number; line: string };

/**
 * The Expo module's surface, as the glue defines it (Task 33). Every call
 * returns void or a value read at once, except `takePhoto` and `scoringLink`, the two calls that answer: intents,
 * not RPC (AGENTS §2).
 */
export type CaptureEngineNative = {
  /** An intent's wire, with the `seq` its ack will name (CD8). */
  send(intent: Record<string, unknown>): void;
  /** A JS record line: native stamps its time when it runs it (RR-13). */
  log(level: string, kind: string, fields: Record<string, unknown>): void;
  /** The last snapshot body native wrote, or null before its first. */
  current(): unknown;
  /** The record's last lines, oldest first, each with its seq. */
  tail(): readonly RecordLine[];
  /**
   * Spec §8: one still to the gallery. One of the two calls that answer (the other is `scoringLink`; AGENTS §2,
   * recorded): native resolves `'saved'` or `'failed'` within its bound, and the port reads anything else as failed.
   * Required, not optional: an absent member would be a photo that quietly never happens.
   */
  takePhoto(): Promise<unknown>;
  /**
   * Spec §10: this match's Remote scoring link. The second call that answers (AGENTS §2, recorded; the first is
   * `takePhoto`): native resolves one `{ outcome, url?, retryAfterS? }` within its own bound (16 s), point to point to
   * this caller and to nobody else, and the port reads anything else as unavailable. The value may carry a
   * credential: never log it. Required, not optional: an absent member would be a button that quietly never works.
   */
  scoringLink(): Promise<unknown>;
  /**
   * R5, and M5 of the Batch 5 review: the app's battery mode, read at once: `unrestricted`, `optimized` or
   * `restricted` (`PowerMode.kt`), or null when native cannot read it. Unknown to iOS. The port reads any other answer,
   * or a throw (a stale build), as unknown.
   */
  powerMode(): unknown;
  addListener(event: 'onSnapshot', listener: (body: unknown) => void): Subscription;
  addListener(event: 'onRecord', listener: (body: RecordLine) => void): Subscription;
  addListener(event: 'onAck', listener: (body: { seq: number }) => void): Subscription;
};

/**
 * `requireOptionalNativeModule('CaptureEngine')`, from `expo` as the code
 * scanner does (PV26: `expo-modules-core` does not resolve under the isolated
 * linker). Null on iOS in S1, in Expo Go and in tests (CD23).
 */
export function loadCaptureEngineNative(): CaptureEngineNative | null {
  return requireOptionalNativeModule<CaptureEngineNative>('CaptureEngine');
}
