import type { PadFills, PadVar } from '@/domain/scoring/padView';
import type { MessageKey } from '@/i18n/messages';
import type { Translator, Vars } from '@/i18n/translate';

/**
 * A pad's words (`PadText`, S2) in the operator's language: a name or a number as it is, a key with its fills, and a
 * fill that is words of its own (a sanction's level) translated first, in the same language. Words with a count take
 * the form the language's rule picks for it (`tp`), from the `.other` key they name.
 */
export function translatePad(translator: Translator, text: PadVar<MessageKey>): string {
  if (typeof text === 'string') return text;
  if (typeof text === 'number') return String(text);
  const vars = text.vars === undefined ? undefined : fills(translator, text.vars);
  if (text.count === undefined) return translator.t(text.key, vars);
  return translator.tp(text.key.slice(0, -OTHER.length), text.count, vars);
}

/** The plural's `.other` form, which a counted text names: the base key is what `tp` reads its forms from. */
const OTHER = '.other';

function fills(translator: Translator, vars: PadFills<MessageKey>): Vars {
  return Object.fromEntries(
    Object.entries(vars).map(([name, value]) => [
      name,
      typeof value === 'object' ? translatePad(translator, value) : value,
    ]),
  );
}
