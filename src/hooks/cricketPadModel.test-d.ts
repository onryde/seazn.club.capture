import { describe, expectTypeOf, it } from 'vitest';
import type { CricketBoardView } from '@/domain/scoring/cricketPad';
import type { CricketPadKey, CricketTap } from '@/domain/scoring/cricketTypes';
import type { PadView } from '@/domain/scoring/padView';
import type { PendingPicks } from '@/domain/scoring/pendingPicks';
import type { PadActions } from '@/hooks/padScreenModel';
import type { CricketPadActions, CricketPadModel, useCricketMatch } from '@/hooks/useCricketMatch';
import type { MessageKey } from '@/i18n/messages';

/**
 * Cricket's pad (S2-4 plan Task 8) is the shared model plus its board and its own buttons, typed, with no cast: the
 * screen gets what the match hook answers. The own list is copied here by hand, so a button moved between pads fails here.
 */
type CricketOwn =
  'record' | 'setPicks' | 'pickServer' | 'start' | 'sendTaps' | 'askDiscard' | 'confirmDiscard';

describe('cricket’s words', () => {
  // The kit takes `PadView<MessageKey>`: a pad key the dictionaries lack must fail to compile, here and at the screen.
  it('every key the pad names is a dictionary key', () => {
    expectTypeOf<CricketPadKey>().toExtend<MessageKey>();
    expectTypeOf<PadView<CricketPadKey>>().toExtend<PadView<MessageKey>>();
  });
});

describe('cricket’s pad', () => {
  it('adds its own buttons to the shared ones', () => {
    expectTypeOf<Exclude<keyof CricketPadActions, keyof PadActions>>().toEqualTypeOf<CricketOwn>();
  });

  it('records a cricket tap and keeps the whole map of picks', () => {
    expectTypeOf<CricketPadActions['record']>().toEqualTypeOf<(tap: CricketTap) => void>();
    expectTypeOf<CricketPadActions['setPicks']>().toEqualTypeOf<(picks: PendingPicks) => void>();
  });

  // That the kit draws it is the screen's to prove: `CricketPadScreen` hands it to `PadContent` uncast (hooks import no ui).
  it('carries the board', () => {
    expectTypeOf<CricketPadModel['board']>().toEqualTypeOf<CricketBoardView>();
  });

  it('is what the match hook answers, without a cast', () => {
    expectTypeOf<
      Extract<ReturnType<typeof useCricketMatch>, { kind: 'pad' }>
    >().toEqualTypeOf<CricketPadModel>();
  });
});
