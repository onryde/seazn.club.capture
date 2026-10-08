import type { EngineSnapshot } from '@/engine/CaptureEnginePort';
import type { FakeCaptureEngine } from '@/engine/FakeCaptureEngine';

/**
 * A phone with nothing to warn about: on the charger, and one that survives the background. The snapshot the fake
 * reports says `charging: true` where it says `false`, and `survivesBackground: true` where it says `false`.
 *
 * Why it exists (owner, 2026-10-08, "one single line all the time"): the status strip says ONE message, the advisory
 * caption when one is up and the status line otherwise. The fake phone starts uncharged and one that would not survive
 * the background (every scene restores both), so Not charging or Keep the app open would take the line over in every
 * test and hide the status line the test reads. A test about a caption, or about the phone as the fake has it, renders
 * with `quiet: false`.
 *
 * The lifted snapshot is kept per source snapshot, so `getSnapshot` is as stable as the fake's own for
 * `useSyncExternalStore`, and nothing but those two fields differs. A test that wants the opposite, a charger that
 * is pulled out, or a background that would end the capture, renders with `quiet: false` and drives the fake itself.
 */
export function quietDevice(engine: FakeCaptureEngine): void {
  const real = engine.getSnapshot.bind(engine);
  const lifted = new WeakMap<EngineSnapshot, EngineSnapshot>();
  Object.assign(engine, {
    getSnapshot: (): EngineSnapshot => {
      const snapshot = real();
      let out = lifted.get(snapshot);
      if (out === undefined) {
        out = {
          ...snapshot,
          survivesBackground: true,
          telemetry:
            snapshot.telemetry.charging === false
              ? { ...snapshot.telemetry, charging: true }
              : snapshot.telemetry,
        };
        lifted.set(snapshot, out);
      }
      return out;
    },
  });
}
