import { memo, useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLanguage } from '@/hooks/useLanguage';
import { LANGS, type Lang } from '@/i18n/language';
import type { MessageKey } from '@/i18n/messages';
import { GhostButton } from '@/ui/components/GhostButton';
import { space } from '@/ui/theme/tokens';

const NAME: Readonly<Record<Lang, MessageKey>> = {
  en: 'language.en',
  es: 'language.es',
  fr: 'language.fr',
  nl: 'language.nl',
};

/** Footer control: tap to show the four languages, pick one, done (decision 8). */
export const LanguagePicker = memo(function LanguagePicker() {
  const { translator, lang, setLang } = useLanguage();
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const label = `${translator.t('home.footer.language')} · ${translator.t(NAME[lang])}`;
  return (
    <View style={styles.picker}>
      <GhostButton label={label} onPress={toggle} expanded={open} />
      {open ? (
        <Choices
          onPick={(next) => {
            setLang(next);
            setOpen(false);
          }}
        />
      ) : null}
    </View>
  );
});

function Choices({ onPick }: { onPick: (lang: Lang) => void }) {
  const { translator } = useLanguage();
  return (
    <View style={styles.choices}>
      {LANGS.map((choice) => (
        <GhostButton
          key={choice}
          label={translator.t(NAME[choice])}
          onPress={() => onPick(choice)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  picker: { gap: space.sm },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
});
