import { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import type { PadTool } from '@/domain/scoring/padView';
import { useT } from '@/hooks/useLanguage';
import type { MessageKey } from '@/i18n/messages';
import { Text } from '@/ui/components/Text';
import { ToolRow } from '@/ui/components/ToolRow';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

type UpdateBannerProps = {
  /** Taps this phone holds that the server has not had: said when there are any. */
  readonly unsent: number;
  /** Open the store, and score this match in the browser instead. */
  readonly onUpdate: () => void;
  readonly onBrowser: () => void;
  /** A line under the buttons: what a button did, when it did not leave the app (the preview's). */
  readonly note: string | null;
};

const UPDATE_TOOLS: readonly PadTool<MessageKey>[] = [
  {
    id: 'update',
    label: { key: 'scoring.card.updateNeeded.update' },
    detail: null,
    kind: 'primary',
    enabled: true,
  },
  {
    id: 'browser',
    label: { key: 'scoring.card.updateNeeded.browser' },
    detail: null,
    kind: 'standard',
    enabled: true,
  },
];

/**
 * Owner ruling 8, an app too old to score this match: "Seazn needs an update to keep scoring this match", with Update
 * and Score in the browser, and the taps it still holds. It stands in the place of the last-tap line and the tools
 * (`cardPlacement`), under the halves, which stay on screen and take no tap. Its buttons are a row of the pad's own
 * tools, so they read and fit as the tools do (padFit.test.ts). Caution edge: something is wrong. Said politely.
 */
export const UpdateBanner = memo(function UpdateBanner({
  unsent,
  onUpdate,
  onBrowser,
  note,
}: UpdateBannerProps) {
  const { t, tp } = useT();
  const press = useCallback(
    (id: string) => (id === 'update' ? onUpdate() : onBrowser()),
    [onUpdate, onBrowser],
  );
  return (
    <View testID="update-banner" accessibilityLiveRegion="polite" style={styles.banner}>
      <Text variant="controlInk">{t('scoring.card.updateNeeded.body')}</Text>
      {unsent > 0 ? (
        <Text variant="control">{tp('scoring.card.updateNeeded.unsent', unsent)}</Text>
      ) : null}
      <ToolRow testID="update-tools" tools={UPDATE_TOOLS} onTool={press} />
      {note === null ? null : <Text variant="control">{note}</Text>}
    </View>
  );
});

const styles = StyleSheet.create({
  banner: {
    gap: space.sm,
    padding: space.sm,
    borderRadius: radius.card,
    borderLeftWidth: layout.padSideBar,
    borderLeftColor: colour.caution,
    backgroundColor: colour.surface,
  },
});
