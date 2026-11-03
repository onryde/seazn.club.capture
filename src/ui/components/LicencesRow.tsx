import { memo, useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { SettingsRow } from '@/ui/components/SettingsRow';
import { Text } from '@/ui/components/Text';
import { LIBSRT_SOURCE, LICENCES } from '@/ui/licences';
import { colour, layout, space } from '@/ui/theme/tokens';

/**
 * Open-source licences as one row of the app's Settings (D22): a row that opens the list below it and shuts it again.
 * MPL-2.0 asks for the source link of libsrt, which is the last line of the list.
 */
export const LicencesRow = memo(function LicencesRow() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((was) => !was), []);
  return (
    <View>
      <SettingsRow label={t('settings.licences.label')} onPress={toggle} expanded={open} />
      {open ? (
        <View testID="licences-list" style={styles.list}>
          {LICENCES.map((entry) => (
            <Text key={entry.name} variant="controlSmall">
              {t('settings.licences.entry', entry)}
            </Text>
          ))}
          <Text variant="controlSmall">
            {t('settings.licences.source', { url: LIBSRT_SOURCE })}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  list: {
    gap: space.xs,
    padding: space.md,
    borderTopWidth: layout.iconBorder,
    borderTopColor: colour.rule,
    backgroundColor: colour.surface2,
  },
});
