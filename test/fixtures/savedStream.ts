import type { SavedCode } from '@/domain/mode/savedCode';
import { sampleDescriptor } from '@/services/fakeDescriptorPort';
import { captureRaw, FIXTURE_NOW } from './wire';

/** A stream code as Home saves it after a 200: v2 raw plus its descriptor. Made-up values. */
export function savedStreamCode(overrides: Partial<SavedCode> = {}): SavedCode {
  return {
    mode: 'stream',
    raw: captureRaw(),
    slot: 1,
    savedAt: FIXTURE_NOW,
    expiresAt: new Date(FIXTURE_NOW.getTime() + 4 * 3600_000),
    descriptor: sampleDescriptor(FIXTURE_NOW),
    ...overrides,
  };
}
