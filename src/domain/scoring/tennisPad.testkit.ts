import type { PadView } from '@/domain/scoring/padView';
import { tennisPad } from '@/domain/scoring/tennisPad';
import { display } from '@/domain/scoring/tennisFold.testkit';
import type { TennisPadKey } from '@/domain/scoring/tennisTypes';

/** The pad drawn from the display of a ledger the real engine took: never a hand-made display. */
export const padOf = (...args: Parameters<typeof display>): PadView<TennisPadKey> =>
  tennisPad(display(...args));
