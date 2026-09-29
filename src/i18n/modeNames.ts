import type { Mode } from '@/domain/mode/Mode';
import type { MessageKey } from '@/i18n/messages';

export const MODE_NAME: Readonly<Record<Mode, MessageKey>> = {
  stream: 'mode.stream',
  scoring: 'mode.scoring',
  dashboard: 'mode.dashboard',
};
