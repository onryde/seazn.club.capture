import { describe, expectTypeOf, it } from 'vitest';
import type { CricketPadKey } from '@/domain/scoring/cricketTypes';
import type { PadView } from '@/domain/scoring/padView';
import type { MessageKey } from '@/i18n/messages';

describe('cricket’s words', () => {
  // The kit takes `PadView<MessageKey>`: a pad key the dictionaries lack must fail to compile, here and at the screen.
  it('every key the pad names is a dictionary key', () => {
    expectTypeOf<CricketPadKey>().toExtend<MessageKey>();
    expectTypeOf<PadView<CricketPadKey>>().toExtend<PadView<MessageKey>>();
  });
});
