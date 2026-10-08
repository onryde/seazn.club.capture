import { describe, expect, it } from 'vitest';
import {
  classify,
  HOLD_MS,
  INITIAL_TRACKER,
  orientationGate,
  track,
  type GateView,
  type Gravity,
  type OrientationTracker,
  type Physical,
  type Target,
} from '@/domain/orientation/orientation';

/** Gravity for a phone rotated `deg` from upright about the screen normal. */
const tilted = (deg: number): Gravity => {
  const rad = (deg * Math.PI) / 180;
  return { x: Math.sin(rad), y: Math.cos(rad), z: 0 };
};
const FLAT: Gravity = { x: 0.05, y: 0.05, z: 0.99 };
/** Gravity for an upright phone whose screen is `deg` above horizontal (0 = on a table). */
const reclined = (deg: number): Gravity => {
  const rad = (deg * Math.PI) / 180;
  return { x: 0, y: Math.sin(rad), z: Math.cos(rad) };
};

describe('classify', () => {
  it.each([
    [0, 'portrait'],
    [25, 'portrait'],
    [180, 'portrait'],
    [65, 'landscape'],
    [90, 'landscape'],
    [-90, 'landscape'],
  ])('%i° from upright is %s', (deg, physical) => {
    expect(classify(tilted(deg))).toBe(physical);
  });

  it.each([40, 45, 55])('%i° is inside the band and decides nothing', (deg) => {
    expect(classify(tilted(deg))).toBeNull();
  });

  it('reads a phone on a table as flat', () => {
    expect(classify(FLAT)).toBe('flat');
  });

  it('reads a phone ~25° off the table as undecided, not flat', () => {
    expect(classify(reclined(25))).toBeNull();
  });

  it('reads an upright phone reclined to ~40° as portrait', () => {
    expect(classify(reclined(40))).toBe('portrait');
  });

  it('reads no gravity as unknown', () => {
    expect(classify({ x: 0, y: 0, z: 0 })).toBe('unknown');
  });
});

/** Feed samples every 50 ms. */
function feed(samples: readonly Gravity[], start: OrientationTracker = INITIAL_TRACKER) {
  return samples.reduce((tracker, g, i) => track(tracker, g, i * 50), start);
}
const repeat = (g: Gravity, n: number) => Array.from({ length: n }, () => g);

describe('track', () => {
  it('settles only after the reading has held for HOLD_MS', () => {
    const justShort = feed(repeat(tilted(90), HOLD_MS / 50));
    expect(justShort.settled).toBe('unknown');
    const held = feed(repeat(tilted(90), HOLD_MS / 50 + 1));
    expect(held.settled).toBe('landscape');
  });

  it('does not flicker when the phone wobbles around 45°', () => {
    const upright = feed(repeat(tilted(0), 10));
    const wobble = [40, 50, 44, 56, 48, 52, 41, 58].map(tilted);
    const after = wobble.reduce((t, g, i) => track(t, g, 1000 + i * 50), upright);
    expect(after.settled).toBe('portrait');
  });

  it('ignores a brief swing that does not hold', () => {
    const upright = feed(repeat(tilted(0), 10));
    const swing = [tilted(90), tilted(90), tilted(0), tilted(0)];
    const states = swing.map((_, n) =>
      swing.slice(0, n + 1).reduce((t, g, i) => track(t, g, 1000 + i * 50), upright),
    );
    expect(states.map((s) => s.settled)).toEqual(['portrait', 'portrait', 'portrait', 'portrait']);
  });

  it('never settles flat while a held phone drifts between 25° and 40° reclined', () => {
    const upright = feed(repeat(tilted(0), 10));
    const drift = [25, 40, 25].flatMap((deg) => repeat(reclined(deg), 8));
    const settled = drift.reduce<OrientationTracker[]>(
      (states, g, i) => [...states, track(states[states.length - 1] ?? upright, g, 1000 + i * 50)],
      [],
    );
    expect(settled.every((s) => s.settled === 'portrait')).toBe(true);
  });

  it('restarts the hold when a reading dips into the band', () => {
    const upright = feed(repeat(tilted(0), 10));
    const interrupted = [90, 90, 90, 45, 90, 90, 90].map(tilted);
    const after = interrupted.reduce((t, g, i) => track(t, g, 1000 + i * 50), upright);
    expect(after.settled).toBe('portrait');
  });
});

describe('orientationGate', () => {
  const UP = { card: 'turnUpright' } as const;
  const SIDE = { card: 'turnSideways' } as const;
  // Expected values from rulings R24, R34, R35 and R37, not from the code.
  // `current` is the lock last applied, or null when nothing is locked yet.
  it.each<[Target, Physical, boolean, Target | null, GateView]>([
    // Held as the target, or flat: the target, no card, whatever is locked.
    ['portrait', 'portrait', false, null, { lock: 'portrait', card: 'none' }],
    ['portrait', 'portrait', true, null, { lock: 'portrait', card: 'none' }],
    ['portrait', 'portrait', true, 'landscape', { lock: 'portrait', card: 'none' }],
    ['portrait', 'flat', false, null, { lock: 'portrait', card: 'none' }],
    ['portrait', 'flat', true, null, { lock: 'portrait', card: 'none' }],
    ['portrait', 'flat', true, 'landscape', { lock: 'portrait', card: 'none' }],
    ['landscape', 'landscape', false, null, { lock: 'landscape', card: 'none' }],
    ['landscape', 'landscape', true, null, { lock: 'landscape', card: 'none' }],
    ['landscape', 'landscape', true, 'portrait', { lock: 'landscape', card: 'none' }],
    ['landscape', 'flat', false, null, { lock: 'landscape', card: 'none' }],
    ['landscape', 'flat', true, null, { lock: 'landscape', card: 'none' }],
    ['landscape', 'flat', true, 'portrait', { lock: 'landscape', card: 'none' }],
    // Held the other way: the target's card; lock to the hands, or keep on air (R24).
    ['portrait', 'landscape', false, null, { lock: 'landscape', ...UP }],
    ['portrait', 'landscape', false, 'portrait', { lock: 'landscape', ...UP }],
    ['portrait', 'landscape', true, null, { lock: 'keep', ...UP }],
    ['portrait', 'landscape', true, 'landscape', { lock: 'keep', ...UP }],
    ['landscape', 'portrait', false, null, { lock: 'portrait', ...SIDE }],
    ['landscape', 'portrait', false, 'landscape', { lock: 'portrait', ...SIDE }],
    ['landscape', 'portrait', true, null, { lock: 'keep', ...SIDE }],
    ['landscape', 'portrait', true, 'portrait', { lock: 'keep', ...SIDE }],
    // No settled reading, not on air: the target, no card (R34).
    ['portrait', 'unknown', false, null, { lock: 'portrait', card: 'none' }],
    ['portrait', 'unknown', false, 'portrait', { lock: 'portrait', card: 'none' }],
    ['portrait', 'unknown', false, 'landscape', { lock: 'portrait', card: 'none' }],
    ['landscape', 'unknown', false, null, { lock: 'landscape', card: 'none' }],
    ['landscape', 'unknown', false, 'landscape', { lock: 'landscape', card: 'none' }],
    ['landscape', 'unknown', false, 'portrait', { lock: 'landscape', card: 'none' }],
    // No settled reading, on air: nothing locked yet → the target (R37); the
    // kept lock matches → nothing; the kept lock disagrees → the target's card (R35).
    ['portrait', 'unknown', true, null, { lock: 'portrait', card: 'none' }],
    ['portrait', 'unknown', true, 'portrait', { lock: 'keep', card: 'none' }],
    ['portrait', 'unknown', true, 'landscape', { lock: 'keep', ...UP }],
    ['landscape', 'unknown', true, null, { lock: 'landscape', card: 'none' }],
    ['landscape', 'unknown', true, 'landscape', { lock: 'keep', card: 'none' }],
    ['landscape', 'unknown', true, 'portrait', { lock: 'keep', ...SIDE }],
  ])('target %s, held %s, on air %s, locked %s → %j', (target, physical, onAir, current, view) => {
    expect(orientationGate(target, physical, onAir, current)).toEqual(view);
  });
});

// Spec §7 and D9: Home and Settings follow the phone (`free`), unless a broadcast is held. Every expected value
// below is written from those two, as its own small oracle, never from `orientationGate`.
const PHYSICALS: readonly Physical[] = ['portrait', 'landscape', 'flat', 'unknown'];
const HOLDINGS: readonly boolean[] = [false, true];

describe('orientationGate: the free target (spec §7, D9)', () => {
  /**
   * §7: not holding, the screen follows the phone, whatever the hands do. D9: holding, the lock never moves
   * under the camera, and a `free` lock (or none) is no lock to keep, so it locks landscape once.
   */
  function oracle(holding: boolean, current: Target | null): GateView {
    if (!holding) return { lock: 'free', card: 'none' };
    if (current === null || current === 'free') return { lock: 'landscape', card: 'none' };
    return { lock: 'keep', card: 'none' };
  }

  it('answers the §7 / D9 oracle for every phone position, holding and lock (32 cases)', () => {
    const currents: readonly (Target | null)[] = [null, 'portrait', 'landscape', 'free'];
    let checked = 0;
    for (const physical of PHYSICALS) {
      for (const holding of HOLDINGS) {
        for (const current of currents) {
          expect({
            physical,
            holding,
            current,
            view: orientationGate('free', physical, holding, current),
          }).toEqual({ physical, holding, current, view: oracle(holding, current) });
          checked += 1;
        }
      }
    }
    expect(checked).toBe(32);
  });

  it.each<[string, Physical, boolean, Target | null, GateView]>([
    ['idle, upright: follows the phone', 'portrait', false, null, { lock: 'free', card: 'none' }],
    [
      'idle, sideways: follows the phone',
      'landscape',
      false,
      'free',
      { lock: 'free', card: 'none' },
    ],
    [
      'idle, and a lock is left from the viewfinder',
      'portrait',
      false,
      'landscape',
      { lock: 'free', card: 'none' },
    ],
    [
      'held, nothing locked: landscape',
      'portrait',
      true,
      null,
      { lock: 'landscape', card: 'none' },
    ],
    [
      'held, from a free lock: landscape',
      'portrait',
      true,
      'free',
      { lock: 'landscape', card: 'none' },
    ],
    [
      'held, landscape applied: kept',
      'portrait',
      true,
      'landscape',
      { lock: 'keep', card: 'none' },
    ],
  ])('%s', (_name, physical, holding, current, view) => {
    expect(orientationGate('free', physical, holding, current)).toEqual(view);
  });

  it('never shows a turn card: Home and Settings have no wrong way up', () => {
    let checked = 0;
    for (const physical of PHYSICALS) {
      for (const holding of HOLDINGS) {
        for (const current of [null, 'portrait', 'landscape', 'free'] as const) {
          expect(orientationGate('free', physical, holding, current).card).toBe('none');
          checked += 1;
        }
      }
    }
    expect(checked).toBe(32);
  });

  it('sequence: free while idle, a remote Go live locks landscape once, and the end frees it again', () => {
    // Settings is open, upright, idle: nothing locked has been applied but `free`.
    expect(orientationGate('free', 'portrait', false, 'free')).toEqual({
      lock: 'free',
      card: 'none',
    });
    // The organiser's Go live arrives (the engine reads `live`): landscape, once.
    expect(orientationGate('free', 'portrait', true, 'free')).toEqual({
      lock: 'landscape',
      card: 'none',
    });
    // Landscape is applied; a tilt upright mid-broadcast keeps it (the camera never rotates under the broadcast).
    expect(orientationGate('free', 'portrait', true, 'landscape')).toEqual({
      lock: 'keep',
      card: 'none',
    });
    // The broadcast ends: back to following the phone.
    expect(orientationGate('free', 'portrait', false, 'landscape')).toEqual({
      lock: 'free',
      card: 'none',
    });
  });
});

describe('orientationGate: leaving a free lock for a fixed target (D9)', () => {
  const CARD = { landscape: 'turnSideways', portrait: 'turnUpright' } as const;

  /**
   * D9: a `free` lock is no lock to keep, so the hands decide even when a broadcast is held: the activity is
   * turned however the phone is held, and the lock holds it there. No settled reading, or flat, or held as the
   * target, locks the target.
   */
  function oracle(target: 'portrait' | 'landscape', physical: Physical): GateView {
    if (physical === 'unknown' || physical === 'flat' || physical === target) {
      return { lock: target, card: 'none' };
    }
    return { lock: physical, card: CARD[target] };
  }

  it('answers the D9 oracle for every target, phone position and holding (16 cases)', () => {
    let checked = 0;
    for (const target of ['portrait', 'landscape'] as const) {
      for (const physical of PHYSICALS) {
        for (const holding of HOLDINGS) {
          expect({
            target,
            physical,
            holding,
            view: orientationGate(target, physical, holding, 'free'),
          }).toEqual({ target, physical, holding, view: oracle(target, physical) });
          checked += 1;
        }
      }
    }
    expect(checked).toBe(16);
  });

  it.each<[string, Physical, boolean, GateView]>([
    // Paired Settings upright, then the viewfinder: the hands lock portrait with the turn card (F16).
    ['upright while paired', 'portrait', true, { lock: 'portrait', card: 'turnSideways' }],
    ['upright while idle', 'portrait', false, { lock: 'portrait', card: 'turnSideways' }],
    [
      'no reading yet: nothing locked, lock the target (R37)',
      'unknown',
      true,
      { lock: 'landscape', card: 'none' },
    ],
    ['sideways', 'landscape', true, { lock: 'landscape', card: 'none' }],
    ['flat', 'flat', true, { lock: 'landscape', card: 'none' }],
  ])('landscape, from free, %s', (_name, physical, holding, view) => {
    expect(orientationGate('landscape', physical, holding, 'free')).toEqual(view);
  });

  it('touches `free` only: a null lock held upright on air still keeps (R35 / R37 unchanged)', () => {
    expect(orientationGate('landscape', 'portrait', true, null)).toEqual({
      lock: 'keep',
      card: 'turnSideways',
    });
    expect(orientationGate('landscape', 'unknown', true, null)).toEqual({
      lock: 'landscape',
      card: 'none',
    });
  });
});
