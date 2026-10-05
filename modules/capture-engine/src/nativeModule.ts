import { requireOptionalNativeModule } from 'expo';

export type Subscription = { remove(): void };

/**
 * One line of native's record and its seq (carry C4c-I3): the process's n-th line is seq n, so a
 * line the tail already holds is known by its number, never by its text.
 */
export type RecordLine = { seq: number; line: string };

/**
 * The Expo module's surface, as the glue defines it (Task 33). Every call
 * returns void or a value read at once: intents, not RPC (AGENTS §2).
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
