import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { parseLang, pickLanguage, type Lang } from '@/i18n/language';
import { createTranslator, type Translator } from '@/i18n/translate';
import { usePorts } from '@/hooks/usePorts';
import type { KeyValueStore } from '@/services/KeyValueStore';
import type { Logger } from '@/services/logger';
import { STORE_KEYS } from '@/services/modeStore';

export type LanguageValue = {
  readonly translator: Translator;
  readonly lang: Lang;
  setLang(lang: Lang): void;
};

const LanguageContext = createContext<LanguageValue | null>(null);

/**
 * The second thing allowed in context (AGENTS §8 as rewritten in Task 15): it
 * changes only when the operator picks a language, never on a tick.
 */
export function LanguageProvider({ children }: { children: ReactNode }) {
  const { kv, logger, deviceLanguages } = usePorts();
  const [stored, setLang] = useStoredLang(kv, logger);
  const lang = pickLanguage(stored, deviceLanguages);
  const value = useMemo(
    () => ({ translator: createTranslator(lang), lang, setLang }),
    [lang, setLang],
  );
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

/**
 * The operator's saved pick. Storage never rejects into the void (ruling R12):
 * a failed read counts as no pick, and a failed write keeps the pick for this
 * session — and is recorded, never silent (spec §5). A read that lands after
 * the operator has picked is ignored, so a slow keystore can never undo a tap.
 */
function useStoredLang(kv: KeyValueStore, logger: Logger): [Lang | null, (lang: Lang) => void] {
  const [stored, setStored] = useState<Lang | null>(null);

  useEffect(() => {
    let alive = true;
    void kv
      .get(STORE_KEYS.lang)
      .catch(() => null)
      .then((text) => {
        if (alive) setStored((picked) => picked ?? parseLang(text));
      });
    return () => {
      alive = false;
    };
  }, [kv]);

  const setLang = useCallback(
    (lang: Lang) => {
      setStored(lang);
      saveLang(kv, logger, lang);
    },
    [kv, logger],
  );
  return [stored, setLang];
}

/** A refused write keeps the pick for this session, and is recorded (spec §5). */
function saveLang(kv: KeyValueStore, logger: Logger, lang: Lang): void {
  void kv
    .set(STORE_KEYS.lang, lang)
    .catch(() => logger.warn('store.write-refused', { action: 'language' }));
}

export function useLanguage(): LanguageValue {
  const value = useContext(LanguageContext);
  if (value === null) throw new Error('useLanguage must be used inside a LanguageProvider');
  return value;
}

export function useT(): Translator {
  return useLanguage().translator;
}
