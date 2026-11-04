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
 * no Ending prompt's `recordEnding` or `voidSanction` (it declares no sanction ending). Who is serving? is answered only
 * through `choose` on its sheet: there is no `pickServing`.
 */
type TableTennisOwn =
  'choose' | 'saveScore' | 'pickServer' | 'start' | 'sendTaps' | 'askDiscard' | 'confirmDiscard';

describe('table tennis’s pad', () => {
  it('adds its own buttons to the shared ones, and none of badminton’s ending prompt', () => {
    expectTypeOf<
      Exclude<keyof TableTennisPadActions, keyof PadActions>
    >().toEqualTypeOf<TableTennisOwn>();
  });

  it('answers Who is serving? only through the sheet’s choice, and the Start screen with a side or none', () => {
    expectTypeOf<TableTennisPadModel['actions']>().not.toHaveProperty('pickServing');
    expectTypeOf<TableTennisPadModel['actions']['choose']>().toEqualTypeOf<(id: string) => void>();
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
