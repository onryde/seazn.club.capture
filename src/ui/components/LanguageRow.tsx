import { memo, useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useBackCloses } from '@/hooks/useBackCloses';
import { useLanguage } from '@/hooks/useLanguage';
import { LANGS, type Lang } from '@/i18n/language';
import type { MessageKey } from '@/i18n/messages';
import { SettingsRow } from '@/ui/components/SettingsRow';
import { Text } from '@/ui/components/Text';
import { colour, layout, space } from '@/ui/theme/tokens';

/** Each language in its own tongue, so the one the operator reads is the one they can find. */
const NAME: Readonly<Record<Lang, MessageKey>> = {
  en: 'language.en',
  es: 'language.es',
  fr: 'language.fr',
  nl: 'language.nl',
};

/**
 * Language in the app's Settings: a row that says which one it is now and opens the four below it (decision 8; the
 * owner moved it here from Home, 2026-11-02). A pick applies at once and closes the list; picking the language already
 * chosen only closes it. Android Back closes an open list first (R31).
 */
export const LanguageRow = memo(function LanguageRow() {
  const { translator, lang, setLang } = useLanguage();
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const close = useCallback(() => setOpen(false), []);
  useBackCloses(open, close);
  const pick = useCallback(
    (next: Lang) => {
      if (next !== lang) setLang(next);
      setOpen(false);
    },
    [lang, setLang],
  );
  return (
    <View>
      <SettingsRow
        label={translator.t('settings.language.label')}
        value={translator.t(NAME[lang])}
        onPress={toggle}
        expanded={open}
      />
      {open ? <Choices current={lang} onPick={pick} /> : null}
    </View>
  );
});

function Choices({ current, onPick }: { current: Lang; onPick: (lang: Lang) => void }) {
  const { translator } = useLanguage();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={translator.t('settings.language.label')}
      style={styles.choices}
    >
      {LANGS.map((choice) => (
        <Choice
          key={choice}
          lang={choice}
          label={translator.t(NAME[choice])}
          checked={choice === current}
          onPick={onPick}
        />
      ))}
    </View>
  );
}

/** One language: its name at the left and the LED at the right, lit for the chosen one, as a switch is lit when on. */
const Choice = memo(function Choice({
  lang,
  label,
  checked,
  onPick,
}: {
  lang: Lang;
  label: string;
  checked: boolean;
  onPick: (lang: Lang) => void;
}) {
  const press = useCallback(() => onPick(lang), [lang, onPick]);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      aria-checked={checked}
      onPress={press}
      style={styles.choice}
    >
      <Text variant={checked ? 'controlInk' : 'control'} style={styles.name}>
        {label}
      </Text>
      <View aria-hidden style={styles.ring}>
        <View testID="language-led" style={checked ? ledOn : styles.led} />
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  /** The list sits on the deeper ground under its row, parted from it by the hairline. */
  choices: {
    backgroundColor: colour.surface2,
    borderTopWidth: layout.iconBorder,
    borderTopColor: colour.rule,
  },
  choice: {
    minHeight: layout.touch,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
  },
  name: { flex: 1 },
  ring: {
    width: layout.radioRing,
    height: layout.radioRing,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: layout.switchBorder,
    borderColor: colour.ink3,
    borderRadius: layout.radioRing / 2,
  },
  led: { width: layout.radioLed, height: layout.radioLed, borderRadius: layout.radioLed / 2 },
  ledOn: { backgroundColor: colour.lime },
});

const ledOn = [styles.led, styles.ledOn];
