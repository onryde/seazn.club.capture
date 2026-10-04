import type { CaptureEnginePort } from '@/engine/CaptureEnginePort';
import { createAbsentCaptureEngine } from '@/engine/absentCaptureEngine';
import { createFakeCaptureEngine, type FakeCaptureEngine } from '@/engine/FakeCaptureEngine';
import { createNativeCaptureEngine, type NativeCaptureEngine } from '@/engine/nativeCaptureEngine';
import type { CaptureEngineNative } from '@/engine/nativeModule';
import {
  createRoutedRecord,
  recordGoesNative,
  type RingRecord,
  type SessionRecord,
} from '@/services/sessionRecord';

export type WiredEngine = {
  readonly engine: CaptureEnginePort;
  /** The fake's extra controls, for the development-only buttons. */
  readonly devEngine: FakeCaptureEngine | null;
  /** The bridge, for the dev probe's `settled()` and the routed record's `forward`. */
  readonly native: NativeCaptureEngine | null;
};

/**
 * CD24: a release build always wires native when the module loads. A
 * development build wires the fake only on `EXPO_PUBLIC_FAKE_ENGINE=1`, so
 * the fake can never ship by accident. No module (iOS in S1, web) wires the
 * absent engine, which ends any pair fatal-error and named (CD23).
 */
export function chooseEngine(input: {
  dev: boolean;
  fakeFlag: string | undefined;
  native: CaptureEngineNative | null;
  now: () => number;
  onRecordLine: (line: string) => void;
}): WiredEngine {
  if (input.dev && input.fakeFlag === '1') {
    const fake = createFakeCaptureEngine(input.now);
    return { engine: fake, devEngine: fake, native: null };
  }
  if (input.native === null) {
    return { engine: createAbsentCaptureEngine(input.now), devEngine: null, native: null };
  }
  const native = createNativeCaptureEngine(input.native, {
    onRecordLine: input.onRecordLine,
    now: input.now,
  });
  return { engine: native, devEngine: null, native };
}

/**
 * The session record as wired (CD7, M16): a JS line goes to native's record
 * while native holds a pairing, and to the ring otherwise; native's lines come
 * back to the ring (`onRecordLine`), so the ring stays the one view. C4c carry
 * (b): the kind is the one native reports when the line is written, read at
 * once from the bridge (`currentKind`), never the JS snapshot's, which may lag
 * it by up to a tick while Expo delivers the event.
 */
export function routedRecordFor(ring: RingRecord, wired: WiredEngine): SessionRecord {
  const { native } = wired;
  return createRoutedRecord(ring, {
    active: () =>
      recordGoesNative(
        native !== null,
        native?.currentKind() ?? wired.engine.getSnapshot().state.kind,
      ),
    forward: (entry) => native?.forward(entry),
  });
}
