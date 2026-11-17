import type { SavedCode } from '@/domain/mode/savedCode';
import { sampleWaiting } from '@/services/fakeCodePort';
import { codeUrl } from '@/services/fetchCodePort';
import { captureRaw, FIXTURE_CODE, FIXTURE_NOW } from './wire';

/** A stream code as Home saves it after a 200: the QR, the waiting fields and the code's URL. Made up. */
export function savedStreamCode(overrides: Partial<SavedCode> = {}): SavedCode {
  return {
    mode: 'stream',
    raw: captureRaw(),
    slot: 1,
    savedAt: FIXTURE_NOW,
    expiresAt: new Date(FIXTURE_NOW.getTime() + 4 * 3600_000),
    stream: {
      waiting: sampleWaiting({ code: FIXTURE_CODE }),
      codeUrl: codeUrl('https://stg.seazn.club', FIXTURE_CODE),
      tapToPair: false,
    },
    scoring: null,
    ...overrides,
  };
}

/**
 * A court code as Home saves it (court stream spec 2026-11-14 §6.1): the descriptor named the court, so it is saved
 * with the code, and the pair seeds native's court from it. Made up.
 */
export function savedCourtCode(court = 'Court 2'): SavedCode {
  const saved = savedStreamCode();
  if (saved.stream === null) throw new Error('a stream code holds its stream fields');
  return { ...saved, stream: { ...saved.stream, waiting: { ...saved.stream.waiting, court } } };
}
