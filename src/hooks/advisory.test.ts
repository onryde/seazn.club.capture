import { describe, expect, it } from 'vitest';
import type { EngineSnapshot, Telemetry } from '@/engine/CaptureEnginePort';
import { IDLE_TELEMETRY } from '@/engine/FakeCaptureEngine';
import { ADVISORY_KEY, selectCharging, selectShedding, topAdvisory } from '@/hooks/advisory';
import en from '@/i18n/en.json';

const QUIET = {
  shed: false,
  overlayFailed: false,
  armed: false,
  overlayOn: true,
  charging: true,
} as const;

describe('topAdvisory (D17: one caption at a time, most important first)', () => {
  it('says nothing when there is nothing to say', () => {
    expect(topAdvisory(QUIET)).toBeNull();
  });

  it('puts heat first: preview paused, still live (AGENTS §8)', () => {
    expect(topAdvisory({ ...QUIET, shed: true, overlayFailed: true, charging: false })).toBe(
      'shed',
    );
  });

  it('says the score preview failed, over the rest', () => {
    expect(topAdvisory({ ...QUIET, overlayFailed: true, armed: true, charging: false })).toBe(
      'overlayFailed',
    );
  });

  it('says nothing of a failed preview the operator has turned off', () => {
    expect(topAdvisory({ ...QUIET, overlayFailed: true, overlayOn: false })).toBeNull();
  });

  // Ruling M6 (overrides D17/D18): a device advisory outranks the score note,
  // which shows while arming only when nothing else is up.
  it('puts a device advisory before the score note while arming', () => {
    expect(topAdvisory({ ...QUIET, armed: true, charging: false })).toBe('notCharging');
    expect(topAdvisory({ ...QUIET, armed: true, shed: true })).toBe('shed');
  });

  it.each([[true], [null]] as const)(
    'tells the operator, while arming, that the score runs ahead when nothing else is up (charging %s)',
    (charging) => {
      expect(topAdvisory({ ...QUIET, armed: true, charging })).toBe('scoreAhead');
    },
  );

  it('drops the score note once not arming, leaving the charging warning', () => {
    expect(topAdvisory({ ...QUIET, armed: false })).toBeNull();
    expect(topAdvisory({ ...QUIET, armed: false, charging: false })).toBe('notCharging');
  });

  it('does not mention the score with the preview off', () => {
    expect(topAdvisory({ ...QUIET, armed: true, overlayOn: false })).toBeNull();
  });

  it('warns when not charging; unknown is not a warning', () => {
    expect(topAdvisory({ ...QUIET, charging: false })).toBe('notCharging');
    expect(topAdvisory({ ...QUIET, charging: null })).toBeNull();
  });
});

describe('the advisory copy', () => {
  it('is the spec’s shed sentence, with no prefix (carry 7, spec §4)', () => {
    expect(en[ADVISORY_KEY.shed]).toBe('Preview paused — still live');
  });
});

function snapshot(telemetry: Partial<Telemetry>): EngineSnapshot {
  return {
    state: { kind: 'publishing', transport: 'srt', sinceEpochMs: 1 },
    telemetry: { ...IDLE_TELEMETRY, ...telemetry },
    descriptor: null,
    camera: 'own',
    reportedAtMs: 1,
    survivesBackground: false,
  };
}

describe('selectShedding (AGENTS §8: any step down the ladder sheds the overlay first)', () => {
  it.each([
    [null, false],
    ['overlay-preview', true],
    ['preview-framerate', true],
    ['encode', true],
  ] as const)('shed %s: %s', (shed, shedding) => {
    expect(selectShedding(snapshot({ shed }))).toBe(shedding);
  });
});

describe('selectCharging', () => {
  it.each([[true], [false], [null]] as const)('passes %s through', (charging) => {
    expect(selectCharging(snapshot({ charging }))).toBe(charging);
  });
});
