import { describe, expectTypeOf, it } from 'vitest';
import type { PadSide } from '@/domain/scoring/padView';
import type { PadActions } from '@/hooks/padScreenModel';
import type {
  TableTennisPadActions,
  TableTennisPadModel,
  useTableTennisMatch,
} from '@/hooks/useTableTennisMatch';

/**
 * Table tennis's pad (plan S2-2 Task 7) is the shared model plus its own buttons, typed, with no cast: the screen gets
 * what the match hook answers. The own list is copied here by hand, so a button moved between pads fails here. It has
 * no Ending prompt's `recordEnding` or `voidSanction` (it declares no sanction ending), and adds Who is serving?'s answer.
 */
type TableTennisOwn =
  | 'choose'
  | 'saveScore'
  | 'pickServer'
  | 'start'
  | 'pickServing'
  | 'sendTaps'
  | 'askDiscard'
  | 'confirmDiscard';

describe('table tennis’s pad', () => {
  it('adds its own buttons to the shared ones, and none of badminton’s ending prompt', () => {
    expectTypeOf<
      Exclude<keyof TableTennisPadActions, keyof PadActions>
    >().toEqualTypeOf<TableTennisOwn>();
  });

  it('answers Who is serving? with a side, and the Start screen with a side or none', () => {
    expectTypeOf<TableTennisPadModel['actions']['pickServing']>().toEqualTypeOf<
      (side: PadSide) => void
    >();
    expectTypeOf<TableTennisPadModel['actions']['pickServer']>().toEqualTypeOf<
      (side: PadSide) => void
    >();
    expectTypeOf<TableTennisPadModel['toss']>().toEqualTypeOf<PadSide | null>();
  });

  it('is what the match hook answers, without a cast', () => {
    expectTypeOf<
      Extract<ReturnType<typeof useTableTennisMatch>, { kind: 'pad' }>
    >().toEqualTypeOf<TableTennisPadModel>();
  });
});
