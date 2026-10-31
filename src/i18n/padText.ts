import type { PadVar } from '@/domain/scoring/padView';
import type { MessageKey } from '@/i18n/messages';
import type { Translator } from '@/i18n/translate';

/**
 * A pad's words (`PadText`, S2) in the operator's language: a name or a number as it is, a key with its fills, and a
 * fill that is words of its own (a sanction's level) translated first, in the same language.
 */
export function translatePad(translator: Translator, text: PadVar<MessageKey>): string {
  if (typeof text === 'string') return text;
  if (typeof text === 'number') return String(text);
  if (text.vars === undefined) return translator.t(text.key);
  const vars = Object.fromEntries(
    Object.entries(text.vars).map(([name, value]) => [
      name,
      typeof value === 'object' ? translatePad(translator, value) : value,
    ]),
  );
  return translator.t(text.key, vars);
}
