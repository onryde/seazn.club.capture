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
  const { kv, deviceLanguages } = usePorts();
  const [stored, setStored] = useState<Lang | null>(null);

  useEffect(() => {
    let alive = true;
    void kv.get(STORE_KEYS.lang).then((text) => {
      if (alive) setStored(parseLang(text));
    });
    return () => {
      alive = false;
    };
  }, [kv]);

  const setLang = useCallback(
    (lang: Lang) => {
      setStored(lang);
      void kv.set(STORE_KEYS.lang, lang);
    },
    [kv],
  );

  const lang = pickLanguage(stored, deviceLanguages);
  const value = useMemo(
    () => ({ translator: createTranslator(lang), lang, setLang }),
    [lang, setLang],
  );
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageValue {
  const value = useContext(LanguageContext);
  if (value === null) throw new Error('useLanguage must be used inside a LanguageProvider');
  return value;
}

export function useT(): Translator {
  return useLanguage().translator;
}
