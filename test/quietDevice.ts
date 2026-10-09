import type { EngineSnapshot } from '@/engine/CaptureEnginePort';
import type { FakeCaptureEngine } from '@/engine/FakeCaptureEngine';

/**
 * A phone with nothing to warn about: on the charger, and one that survives the background. The snapshot the fake
 * reports says `charging: true` where it says `false`, and `survivesBackground: true` where it says `false`.
 *
 * Why it exists (owner, 2026-10-08, "one single line all the time", two tiers): the status strip says ONE message. An
 * URGENT status line (a refusal, trouble, a stopped stream, Back's "hold Stop") always wins it, but an advisory caption
 * beats a ROUTINE one (Live, Waiting for Go live). The fake phone starts uncharged and one that would not survive the
 * background (every scene restores both), so Not charging or Keep the app open would take the line over from a routine
 * status line a test reads. Only such a test renders with `quiet: true`; a test about a caption, or about an urgent
 * line, uses the fake's own phone.
 *
 * The lifted snapshot is kept per source snapshot, so `getSnapshot` is as stable as the fake's own for
 * `useSyncExternalStore`, and nothing but those two fields differs. A test that wants the opposite, a charger that
 * is pulled out, or a background that would end the capture, renders without `quiet` and drives the fake itself.
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
