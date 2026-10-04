import { describe, expect, it } from 'vitest';
import type { SessionState } from '@/domain/session/SessionState';
import type { Readiness } from '@/domain/session/Pairing';
import type { EngineSnapshot } from '@/engine/CaptureEnginePort';
import { IDLE_TELEMETRY } from '@/engine/unreported';
import {
  CHIP_ORDER,
  blockerReason,
  goLiveBlocker,
  selectCameraReady,
  selectNetworkReachable,
  selectSoundReady,
  tallyPlateFor,
  tallyTone,
  type Chip,
  type Preflight,
  type TallyPlate,
  type TallyTone,
} from '@/hooks/preflight';
import { selectStatusKey } from '@/hooks/statusKey';
import { createTranslator } from '@/i18n/translate';

const { t } = createTranslator('en');

const ALL_GREEN: Preflight = { camera: true, network: true, sound: true };

const paired = (ready: Partial<Readiness>): EngineSnapshot => ({
  state: { kind: 'paired' },
  telemetry: IDLE_TELEMETRY,
  pairing: null,
  broadcast: null,
  ready: { camera: true, sound: true, network: true, held: true, ...ready },
  refusal: null,
  lastEnd: null,
  unpaired: null,
  codeEndedPending: false,
  camera: 'own',
  reportedAtMs: 0,
  survivesBackground: true,
});

describe('goLiveBlocker (spec §1: Go live only when every chip is green)', () => {
  it('lets Go live through with every chip green', () => {
    expect(goLiveBlocker(ALL_GREEN)).toBeNull();
  });

  it.each([
    [{ camera: false, network: false }, 'camera'],
    [{ camera: false, sound: false }, 'camera'],
    [{ network: false, sound: false }, 'network'],
    [{ sound: false }, 'sound'],
    [{ camera: false, network: false, sound: false }, 'camera'],
  ] as const)('names the first chip that is off: %j → %s', (off, chip) => {
    expect(goLiveBlocker({ ...ALL_GREEN, ...off })).toBe(chip);
  });

  it('shows the chips in spec §1’s order: camera, sound, network', () => {
    expect(CHIP_ORDER).toEqual(['camera', 'sound', 'network']);
  });
});

describe('Go live’s reason (ruling I3)', () => {
  it.each([
    ['camera', 'Camera not ready'],
    ['network', 'No network'],
    ['sound', 'No sound'],
  ] as const)('the %s chip reads %s', (chip, said) => {
    const key = blockerReason(chip);
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
      expect(selectCameraReady({ ...paired({ camera: true }), camera })).toBe(false);
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

  /**
   * One authority on each pre-flight question (S0's audio-floor lesson): the
   * status line names the same chip the Go live control is blocked on.
   */
  const NAMED: Readonly<Record<Chip, string>> = {
    camera: 'stream.status.noCamera',
    network: 'stream.status.noNetwork',
    sound: 'stream.status.noSound',
  };
  const combos = [false, true].flatMap((camera) =>
    [false, true].flatMap((network) => [false, true].map((sound) => ({ camera, network, sound }))),
  );
  it('sweeps every combination of the three', () => {
    expect(combos).toHaveLength(8);
  });
  it.each(combos)('agrees with the status line for %j', (ready) => {
    const s = paired(ready);
    const blocker = goLiveBlocker({
      camera: selectCameraReady(s),
      network: selectNetworkReachable(s),
      sound: selectSoundReady(s),
    });
    const expected = blocker === null ? 'stream.status.ready' : NAMED[blocker];
    expect(selectStatusKey(s)).toBe(expected);
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
    // Today's plates on the new broadcast kinds; Task 28 gives them their own.
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
