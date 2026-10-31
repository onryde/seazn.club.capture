import { useCallback } from 'react';
import type { PadVar } from '@/domain/scoring/padView';
import { useT } from '@/hooks/useLanguage';
import type { MessageKey } from '@/i18n/messages';
import { translatePad } from '@/i18n/padText';

/** The scoring kit's translator: a pad's words (`translatePad`) in the language picked now. Stable per language. */
export function usePadText(): (text: PadVar<MessageKey>) => string {
  const translator = useT();
  return useCallback((text: PadVar<MessageKey>) => translatePad(translator, text), [translator]);
}
