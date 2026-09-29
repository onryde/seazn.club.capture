import type { Mode } from '@/domain/mode/Mode';
import type { MessageKey } from '@/i18n/messages';

/** Home's display order. */
export const MODES: readonly Mode[] = ['stream', 'scoring', 'dashboard'];

export const MODE_PURPOSE: Readonly<Record<Mode, MessageKey>> = {
  stream: 'home.tile.stream.purpose',
  scoring: 'home.tile.scoring.purpose',
  dashboard: 'home.tile.dashboard.purpose',
};

/** Which code opens a mode. Unbuilt modes say "Coming soon"; S2 and S4 add theirs. */
export const MODE_HINT: Readonly<Record<Mode, MessageKey>> = {
  stream: 'home.tile.stream.hint',
  scoring: 'home.tile.comingSoon',
  dashboard: 'home.tile.comingSoon',
};
