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
    ...overrides,
  };
}
