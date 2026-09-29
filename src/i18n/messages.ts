import en from '@/i18n/en.json';
import es from '@/i18n/es.json';
import fr from '@/i18n/fr.json';
import nl from '@/i18n/nl.json';
import type { Lang } from '@/i18n/language';

/** English is the source: a key exists when it exists in en.json. */
export type MessageKey = Exclude<keyof typeof en, '_review'>;
export type Messages = Readonly<Record<string, string>>;

export const DICTIONARIES: Readonly<Record<Lang, Messages>> = { en, es, fr, nl };
