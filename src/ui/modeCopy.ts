import type { Mode } from '@/domain/mode/Mode';
import type { MessageKey } from '@/i18n/messages';

/** Home's display order. */
export const MODES: readonly Mode[] = ['stream', 'scoring', 'matchday'];

export const MODE_PURPOSE: Readonly<Record<Mode, MessageKey>> = {
  stream: 'home.tile.stream.purpose',
  scoring: 'home.tile.scoring.purpose',
  matchday: 'home.tile.matchday.purpose',
};

/** Which code opens a mode. Every mode is built, so each says its own (MD-2 Task 1 added Match Day's). */
export const MODE_HINT: Readonly<Record<Mode, MessageKey>> = {
  stream: 'home.tile.stream.hint',
  scoring: 'home.tile.scoring.hint',
  matchday: 'home.tile.matchday.hint',
};
