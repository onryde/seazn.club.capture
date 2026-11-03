import { describe, expectTypeOf, it } from 'vitest';
import type { PadSide } from '@/domain/scoring/padView';
import type { PadActions, PadScreenModel } from '@/hooks/padScreenModel';
import type {
  BadmintonPadActions,
  BadmintonPadModel,
  useBadmintonMatch,
} from '@/hooks/useBadmintonMatch';
import type { MatchSender } from '@/hooks/useScoringMatch';
import type { BadmintonPadPreview } from '../../test/useBadmintonPadPreview';

/**
 * Pad per sport (owner, 2026-11-02): every sport's pad shares only what every pad has, and a sport's own buttons are in
 * its own model, so a sport's screen gets them typed, with no cast and no condition on the sport. The lists are copied
 * here by hand: a button moved between them fails here.
 */
type Shared = 'home' | 'tapHalf' | 'undo' | 'tool' | 'cancel' | 'dismiss' | 'update' | 'browser';
type BadmintonOwn =
  | 'choose'
  | 'saveScore'
  | 'recordEnding'
  | 'voidSanction'
  | 'pickServer'
  | 'sendTaps'
  | 'askDiscard'
  | 'confirmDiscard';

describe('the actions every sport’s pad shares', () => {
  it('are these and no more', () => {
    expectTypeOf<keyof PadActions>().toEqualTypeOf<Shared | 'details' | 'history'>();
  });

  it('carry no Start screen: who serves first is a sport’s own', () => {
    expectTypeOf<PadScreenModel<string, null>>().not.toHaveProperty('toss');
  });
});

describe('badminton’s pad', () => {
  it('adds its own buttons to the shared ones', () => {
    expectTypeOf<Exclude<keyof BadmintonPadActions, keyof PadActions>>().toEqualTypeOf<
      BadmintonOwn | 'start'
    >();
    expectTypeOf<BadmintonPadModel['actions']['pickServer']>().toEqualTypeOf<
      (side: PadSide) => void
    >();
    expectTypeOf<BadmintonPadModel['toss']>().toEqualTypeOf<PadSide | null>();
  });

  it('is what the match hook answers, and what the preview hands the screen, without a cast', () => {
    expectTypeOf<
      Extract<ReturnType<typeof useBadmintonMatch>, { kind: 'pad' }>
    >().toEqualTypeOf<BadmintonPadModel>();
    expectTypeOf<BadmintonPadPreview>().toMatchTypeOf<BadmintonPadModel>();
    expectTypeOf<BadmintonPadPreview['actions']['voidSanction']>().toEqualTypeOf<() => void>();
  });
});

describe('the generic sender', () => {
  it('answers the reconnect question with one of two words, and says whether it was taken', () => {
    expectTypeOf<Parameters<MatchSender<never>['answer']>>().toEqualTypeOf<
      [answer: 'send' | 'discard']
    >();
  });

  it('names no sport’s Undo: only the ending prompt’s, which any sport may have', () => {
    expectTypeOf<Parameters<MatchSender<never>['undo']>>().toEqualTypeOf<[only?: 'ending']>();
  });
});
