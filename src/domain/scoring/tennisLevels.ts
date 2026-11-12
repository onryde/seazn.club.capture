import type { PadCard, PadText } from '@/domain/scoring/padView';
import type { TennisPadKey, TennisSeenLevel } from '@/domain/scoring/tennisTypes';

/**
 * A violation's level in the pad's words and in the card it draws (S2-7 Task 6; ruling 218): the one place the pad, the
 * violation steps and History name a level. Typed over every level the engine lists, `default` included, so a level the
 * web may write but the phone never sends still has its word and its card.
 */

const WORDS = {
  warning: 'scoring.tennis.level.warning',
  point_penalty: 'scoring.tennis.level.pointPenalty',
  game_penalty: 'scoring.tennis.level.gamePenalty',
  default: 'scoring.tennis.level.default',
} as const satisfies Readonly<Record<TennisSeenLevel, TennisPadKey>>;

export const levelWord = (level: TennisSeenLevel): PadText<TennisPadKey> => ({ key: WORDS[level] });

/** A warning is the yellow card; a penalty, and a default the web wrote, the red (spec §5). */
export const LEVEL_CARDS = {
  warning: ['caution'],
  point_penalty: ['dismissal'],
  game_penalty: ['dismissal'],
  default: ['dismissal'],
} as const satisfies Readonly<Record<TennisSeenLevel, readonly PadCard[]>>;
