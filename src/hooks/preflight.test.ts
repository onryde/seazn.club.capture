import { describe, expect, it } from 'vitest';
import type { SessionState } from '@/domain/session/SessionState';
import type { NotReady, Readiness } from '@/domain/session/Pairing';
import type { CameraState, EngineSnapshot } from '@/engine/CaptureEnginePort';
import { IDLE_TELEMETRY } from '@/engine/unreported';
import {
  CHIP_ORDER,
  blockerReason,
  selectBlocker,
  selectCameraReady,
  selectNetworkReachable,
  selectSoundReady,
  tallyPlateFor,
  tallyTone,
  type TallyPlate,
  type TallyTone,
} from '@/hooks/preflight';
import { createTranslator } from '@/i18n/translate';

const { t } = createTranslator('en');

const paired = (ready: Partial<Readiness>, camera: CameraState | null = 'own'): EngineSnapshot => ({
  state: { kind: 'paired' },
  telemetry: IDLE_TELEMETRY,
  pairing: null,
  broadcast: null,
  ready: { camera: true, sound: true, network: true, held: true, ...ready },
  refusal: null,
  lastEnd: null,
  unpaired: null,
  codeEndedPending: false,
  camera,
  reportedAtMs: 0,
  survivesBackground: true,
});

/**
 * Native's verdict (A11), in native's order, so the blocker at the control and
 * native's `notReady` never disagree. The rows are the amendment's _Readiness_
 * table, its order camera, sound, network, held, written out.
 */
describe('selectBlocker (A11: native’s verdict, in native’s order)', () => {
  it('lets Go live through with every check passing and the camera ours', () => {
    expect(selectBlocker(paired({}))).toBeNull();
  });

  it.each<[Partial<Readiness>, NotReady]>([
    [{ camera: false }, 'camera'],
    [{ sound: false }, 'sound'],
    [{ network: false }, 'network'],
    [{ held: false }, 'held'],
    [{ sound: false, held: false }, 'sound'],
    [{ sound: false, network: false }, 'sound'],
    [{ network: false, held: false }, 'network'],
    [{ camera: false, sound: false, network: false, held: false }, 'camera'],
  ])('names the first check native says is off: %j → %s', (off, blocker) => {
    expect(selectBlocker(paired(off))).toBe(blocker);
  });

  // M2: never READY beside a camera line; no session is no camera of ours.
  it.each(['taken', 'reopening', 'resuming', 'switching', null] as const)(
    'reads a %s camera as the camera blocker, whatever native says of it',
    (camera) => {
      expect(selectBlocker(paired({}, camera))).toBe('camera');
      expect(selectBlocker(paired({ sound: false }, camera))).toBe('sound');
    },
  );

  /** Every combination of the four checks, against the amendment's order written out. */
  const AMENDMENT_ORDER = ['camera', 'sound', 'network', 'held'] as const;
  const combos = [false, true].flatMap((camera) =>
    [false, true].flatMap((sound) =>
      [false, true].flatMap((network) =>
        [false, true].map((held) => ({ camera, sound, network, held })),
      ),
    ),
  );
  it('sweeps all sixteen combinations (PV12: zero is a failure)', () => {
    expect(combos).toHaveLength(16);
  });
  it.each(combos)('agrees with the amendment’s order for %j', (ready) => {
    const expected = AMENDMENT_ORDER.find((check) => !ready[check]) ?? null;
    expect(selectBlocker(paired(ready))).toBe(expected);
  });

  it('shows the chips in spec §1’s order: camera, sound, network, and no held chip', () => {
    expect(CHIP_ORDER).toEqual(['camera', 'sound', 'network']);
  });
});

describe('Go live’s reason (ruling I3)', () => {
  it.each([
    ['camera', 'Camera not ready'],
    ['network', 'No network'],
    ['sound', 'Mic not available'],
    // Amendment §2: a flat phone has no chip; it blocks, and says so here.
    ['held', 'Turn the phone sideways'],
  ] as const)('the %s blocker reads %s', (blocker, said) => {
    const key = blockerReason(blocker);
    expect(key === null ? null : t(key)).toBe(said);
  });

  it('says nothing with nothing blocking', () => {
    expect(blockerReason(null)).toBeNull();
  });
});

describe('the chips read native’s verdict (A11)', () => {
  // M2: the chip reads whose camera it is, not only native's readiness.
  it.each(['taken', 'reopening', 'resuming', 'switching', null] as const)(
    'a %s camera is not ready, whatever native says of it',
    (camera) => {
      expect(selectCameraReady(paired({ camera: true }, camera))).toBe(false);
    },
  );

  it('reads the camera, the network and the sound as native reports them', () => {
    const off = paired({ camera: false, network: false, sound: false });
    const on = paired({});
    const read = (s: EngineSnapshot) => [
      selectCameraReady(s),
      selectNetworkReachable(s),
      selectSoundReady(s),
    ];
    expect(read(off)).toEqual([false, false, false]);
    expect(read(on)).toEqual([true, true, true]);
  });

  // A11: the JS audio floor is no longer the judge; a silent meter with native's yes reads ready.
  it('reads sound from native, not from the level', () => {
    const quiet = { ...paired({ sound: true }), telemetry: { ...IDLE_TELEMETRY, audioLevel: 0 } };
    const loud = { ...paired({ sound: false }), telemetry: { ...IDLE_TELEMETRY, audioLevel: 0.9 } };
    expect([selectSoundReady(quiet), selectSoundReady(loud)]).toEqual([true, false]);
  });

  /** One authority (S0's audio-floor lesson): a chip that is off always blocks. */
  it.each([
    ['camera', { camera: false }],
    ['sound', { sound: false }],
    ['network', { network: false }],
  ] as const)('a %s chip that is off blocks Go live', (_chip, ready) => {
    expect(selectBlocker(paired(ready))).not.toBeNull();
  });
});

describe('the tally plate (spec §4, D14)', () => {
  it.each<[SessionState['kind'], boolean, TallyPlate]>([
    ['idle', false, 'starting'],
    ['idle', true, 'starting'],
    ['pairing', false, 'starting'],
    ['pairing', true, 'starting'],
    ['paired', false, 'notReady'],
    ['paired', true, 'ready'],
    // The amendment names no plate for Starting: they keep CONNECTING (Task 28's report).
    ['arming', true, 'connecting'],
    ['armed', false, 'connecting'],
    ['connecting', true, 'connecting'],
    ['publishing', true, 'live'],
    ['publishing', false, 'live'],
    ['degraded', true, 'trouble'],
    ['reconnecting', true, 'trouble'],
    ['ended', true, 'ended'],
  ])('%s (ready: %s) shows %s', (kind, ready, plate) => {
    expect(tallyPlateFor(kind, ready)).toBe(plate);
  });

  it('never shows LIVE while connecting: LIVE only while frames advance (F-P5-6)', () => {
    expect(tallyPlateFor('connecting', true)).not.toBe('live');
  });

  it('is red only for LIVE: red means on air (AGENTS §5)', () => {
    const plates: TallyPlate[] = [
      'starting',
      'notReady',
      'ready',
      'connecting',
      'live',
      'trouble',
      'ended',
    ];
    expect(plates.filter((plate) => tallyTone(plate) === 'live')).toEqual(['live']);
    expect(tallyTone('trouble')).toBe('degraded');
    expect(tallyTone('ready')).toBe('healthy');
  });

  it.each<[TallyPlate, TallyTone]>([
    ['starting', 'inert'],
    ['notReady', 'inert'],
    ['ready', 'healthy'],
    ['connecting', 'inert'],
    ['live', 'live'],
    ['trouble', 'degraded'],
    ['ended', 'inert'],
  ])('%s is %s (D14)', (plate, tone) => {
    expect(tallyTone(plate)).toBe(tone);
  });
});
