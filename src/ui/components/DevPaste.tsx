import { memo, useCallback, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { GhostButton } from '@/ui/components/GhostButton';
import { colour, font, radius, space } from '@/ui/theme/tokens';

/**
 * Development builds only: feed a code without a camera, for laptops and
 * emulators. HomeScreen renders it only when `devTools` is true, which is
 * `__DEV__` and therefore false in every release build.
 */
export const DevPaste = memo(function DevPaste({ onUse }: { onUse: (raw: string) => void }) {
  const { t } = useT();
  const [raw, setRaw] = useState('');
  const use = useCallback(() => onUse(raw), [onUse, raw]);
  return (
    <View style={styles.row}>
      <TextInput
        value={raw}
        onChangeText={setRaw}
        placeholder={t('home.dev.paste')}
        placeholderTextColor={colour.ink3}
        style={styles.input}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <GhostButton label={t('home.dev.use')} onPress={use} />
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'center' },
  input: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: space.sm,
    color: colour.ink,
    fontFamily: font.body,
    borderWidth: 1,
    borderColor: colour.surface2,
    borderRadius: radius.card,
  },
});
