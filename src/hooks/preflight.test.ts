import { describe, expect, it } from 'vitest';
import type { SessionState } from '@/domain/session/SessionState';
import type { EngineSnapshot, Telemetry } from '@/engine/CaptureEnginePort';
import { IDLE_TELEMETRY } from '@/engine/FakeCaptureEngine';
import {
  CHIP_ORDER,
  codeCheck,
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

const ALL_GREEN: Preflight = { code: true, camera: true, network: true, sound: true };

const armed = (telemetry: Partial<Telemetry>): EngineSnapshot => ({
  state: { kind: 'armed' },
  telemetry: { ...IDLE_TELEMETRY, ...telemetry },
  descriptor: null,
  camera: 'own',
  reportedAtMs: 0,
  survivesBackground: true,
});

describe('goLiveBlocker (spec §1: Go live only when every chip is green)', () => {
  it('lets Go live through with every chip green', () => {
    expect(goLiveBlocker(ALL_GREEN)).toBeNull();
  });

  it.each([
    [{ code: false, camera: false }, 'code'],
    [{ camera: false, network: false }, 'camera'],
    [{ camera: false, sound: false }, 'camera'],
    [{ network: false, sound: false }, 'network'],
    [{ sound: false }, 'sound'],
    [{ code: false, camera: false, network: false, sound: false }, 'code'],
  ] as const)('names the first chip that is off: %j → %s', (off, chip) => {
    expect(goLiveBlocker({ ...ALL_GREEN, ...off })).toBe(chip);
  });

  it('shows the chips in spec §1’s order: camera, sound, network, code', () => {
    expect(CHIP_ORDER).toEqual(['camera', 'sound', 'network', 'code']);
  });
});

/**
 * R3: the code chip is the saved code usable AND the warming gate open. One
 * reading for the chip, Go live's blocker and the status line
 * (viewfinderStatusKey), so the three can never disagree.
 */
describe('codeCheck', () => {
  it.each([
    [{ unusable: false, deadlineKnown: true, passed: false }, 'usable'],
    [{ unusable: false, deadlineKnown: true, passed: true }, 'timedOut'],
    [{ unusable: false, deadlineKnown: false, passed: false }, 'noDeadline'],
    [{ unusable: true, deadlineKnown: true, passed: false }, 'unusable'],
    // No wait on the phone fixes an unusable code, so it is named first.
    [{ unusable: true, deadlineKnown: true, passed: true }, 'unusable'],
    [{ unusable: true, deadlineKnown: false, passed: false }, 'unusable'],
  ] as const)('%j reads %s', (input, check) => {
    expect(codeCheck(input)).toBe(check);
  });

  it('turns the chip green only for a usable code before its deadline', () => {
    const green = (['usable', 'timedOut', 'noDeadline', 'unusable'] as const).filter(
      (check) => goLiveBlocker({ ...ALL_GREEN, code: check === 'usable' }) === null,
    );
    expect(green).toEqual(['usable']);
  });
});

describe('the chips read the snapshot', () => {
  it('reads the camera and the network as native reports them', () => {
    const off = armed({ cameraReady: false, networkReachable: false });
    const on = armed({ cameraReady: true, networkReachable: true });
    expect([selectCameraReady(off), selectNetworkReachable(off)]).toEqual([false, false]);
    expect([selectCameraReady(on), selectNetworkReachable(on)]).toEqual([true, true]);
  });

  it.each([
    [0, false],
    [0.049, false],
    [0.05, true],
    [0.4, true],
  ])('counts a level of %s as sound: %s (the floor itself counts)', (audioLevel, ready) => {
    expect(selectSoundReady(armed({ audioLevel }))).toBe(ready);
  });

  /**
   * One authority on each pre-flight question (S0's audio-floor lesson): the
   * status line names the same chip the Go live control is blocked on.
   */
  const NAMED: Readonly<Record<Exclude<Chip, 'code'>, string>> = {
    camera: 'stream.status.noCamera',
    network: 'stream.status.noNetwork',
    sound: 'stream.status.noSound',
  };
  const combos = [false, true].flatMap((cameraReady) =>
    [false, true].flatMap((networkReachable) =>
      [0.01, 0.4].map((audioLevel) => ({ cameraReady, networkReachable, audioLevel })),
    ),
  );
  it.each(combos)('agrees with the status line for %j', (telemetry) => {
    const s = armed(telemetry);
    const blocker = goLiveBlocker({
      code: true,
      camera: selectCameraReady(s),
      network: selectNetworkReachable(s),
      sound: selectSoundReady(s),
    });
    const expected =
      blocker === null ? 'stream.status.ready' : NAMED[blocker as keyof typeof NAMED];
    expect(selectStatusKey(s)).toBe(expected);
  });
});

describe('the tally plate (spec §4, D14)', () => {
  it.each<[SessionState['kind'], boolean, TallyPlate]>([
    ['idle', false, 'starting'],
    ['idle', true, 'starting'],
    ['armed', false, 'notReady'],
    ['armed', true, 'ready'],
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
