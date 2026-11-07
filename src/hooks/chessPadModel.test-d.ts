import { describe, expectTypeOf, it } from 'vitest';
import type { TiebreakDraft, TiebreakStep } from '@/domain/scoring/chessTiebreakSheet';
import type {
  ChessArmageddonResult,
  ChessMethod,
  ChessPadKey,
  ChessRung,
  ChessTiebreakScore,
} from '@/domain/scoring/chessTypes';
import type { PadSide, PadView } from '@/domain/scoring/padView';
import type { PadActions } from '@/hooks/padScreenModel';
import type { ChessPadActions, ChessPadModel, useChessMatch } from '@/hooks/useChessMatch';
import type { ChessSheetView } from '@/hooks/useChessSheets';
import type { MessageKey } from '@/i18n/messages';

/**
 * Chess's pad (plan S2-3 Task 3) is the shared model plus its own buttons, typed, with no cast: the screen gets what the
 * match hook answers. The own list is copied here by hand, so a button moved between pads fails here. The How sheet
 * holds the SEAT that won (the Batch A review's ruling), never a colour; so does the tie-break sheet (S2-3b).
 */
type ChessOwn =
  | 'start'
  | 'pickServer'
  | 'choose'
  | 'pickMethod'
  | 'record'
  | 'cancelSheet'
  | 'pickRung'
  | 'pickTiebreakWinner'
  | 'pickScore'
  | 'pickBlack'
  | 'pickArmageddonResult'
  | 'recordTiebreak'
  | 'swap'
  | 'sendTaps'
  | 'askDiscard'
  | 'confirmDiscard';

describe('chess’s words', () => {
  // The kit takes `PadView<MessageKey>`: a pad key the dictionaries lack must fail to compile at the screen.
  it('every key the pad names is a dictionary key', () => {
    expectTypeOf<ChessPadKey>().toExtend<MessageKey>();
    expectTypeOf<PadView<ChessPadKey>>().toExtend<PadView<MessageKey>>();
  });
});

describe('chess’s pad', () => {
  it('adds its own buttons to the shared ones, and none of badminton’s ending prompt', () => {
    expectTypeOf<Exclude<keyof ChessPadActions, keyof PadActions>>().toEqualTypeOf<ChessOwn>();
  });

  it('opens its sheet for a seat or for a draw, and picks a method or none', () => {
    expectTypeOf<ChessPadModel['actions']['choose']>().toEqualTypeOf<
      (winner: PadSide | null) => void
    >();
    expectTypeOf<ChessPadModel['actions']['pickMethod']>().toEqualTypeOf<
      (method: ChessMethod | null) => void
    >();
    expectTypeOf<ChessPadModel['toss']>().toEqualTypeOf<PadSide | null>();
  });

  it('holds the seat that won in the How sheet, never a colour', () => {
    expectTypeOf<Extract<ChessSheetView, { kind: 'how' }>>().toEqualTypeOf<{
      readonly kind: 'how';
      readonly winner: PadSide | null;
      readonly picked: ChessMethod | null;
      readonly methods: readonly ChessMethod[];
    }>();
  });

  it('picks a tie-break’s rung, winner, score, Black and result by seat and word, never by colour', () => {
    type Actions = ChessPadModel['actions'];
    expectTypeOf<Actions['pickRung']>().toEqualTypeOf<(rung: ChessRung) => void>();
    expectTypeOf<Actions['pickTiebreakWinner']>().toEqualTypeOf<(side: PadSide) => void>();
    expectTypeOf<Actions['pickScore']>().toEqualTypeOf<
      (score: ChessTiebreakScore | null) => void
    >();
    expectTypeOf<Actions['pickBlack']>().toEqualTypeOf<(side: PadSide) => void>();
    expectTypeOf<Actions['pickArmageddonResult']>().toEqualTypeOf<
      (result: ChessArmageddonResult) => void
    >();
    expectTypeOf<Actions['recordTiebreak']>().toEqualTypeOf<() => void>();
  });

  it('holds the tie-break sheet’s choices as seats, rungs and words, and the seat that advances', () => {
    expectTypeOf<Extract<ChessSheetView, { kind: 'tiebreak' }>>().toEqualTypeOf<{
      readonly kind: 'tiebreak';
      readonly step: TiebreakStep;
      readonly rungs: readonly ChessRung[];
      readonly draft: TiebreakDraft;
      readonly advances: PadSide | null;
    }>();
    expectTypeOf<TiebreakDraft['winner']>().toEqualTypeOf<PadSide | null>();
    expectTypeOf<TiebreakDraft['black']>().toEqualTypeOf<PadSide | null>();
  });

  it('is what the match hook answers, without a cast', () => {
    expectTypeOf<
      Extract<ReturnType<typeof useChessMatch>, { kind: 'pad' }>
    >().toEqualTypeOf<ChessPadModel>();
  });
});
