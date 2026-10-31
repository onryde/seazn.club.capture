import { memo } from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import type { PadSync } from '@/domain/scoring/padView';
import { useT } from '@/hooks/useLanguage';
import type { Translator } from '@/i18n/translate';
import { Text } from '@/ui/components/Text';
import { colour, layout, space } from '@/ui/theme/tokens';

/**
 * Whether this phone's taps have reached the server: a dot and a few words. Lime when synced; lilac while sending;
 * caution orange offline and when the server refused a tap (never red: red means ON AIR, AGENTS §5). The words take at
 * most `padSyncLines`, then an ellipsis (padFit.test.ts holds the longest in four languages at 320 dp); the dot is
 * drawing only.
 */
export const SyncDot = memo(function SyncDot({ sync }: { readonly sync: PadSync }) {
  const translator = useT();
  return (
    <View testID="sync" style={styles.row}>
      <View testID="sync-dot" aria-hidden style={DOT[sync.kind]} />
      <Text variant="metricUnit" numberOfLines={layout.padSyncLines} style={styles.words}>
        {syncWords(sync, translator)}
      </Text>
    </View>
  );
});

function syncWords(sync: PadSync, { t, tp }: Translator): string {
  switch (sync.kind) {
    case 'synced':
      return t('scoring.sync.synced');
    case 'sending':
      return tp('scoring.sync.sending', sync.count);
    case 'offline':
      return tp('scoring.sync.offline', sync.count);
    case 'refused':
      return tp('scoring.sync.refused', sync.count);
  }
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 1, minWidth: 0 },
  words: { flexShrink: 1 },
  dot: { width: layout.syncDot, height: layout.syncDot, borderRadius: layout.syncDot / 2 },
  synced: { backgroundColor: colour.lime },
  sending: { backgroundColor: colour.ink3 },
  trouble: { backgroundColor: colour.caution },
});

const DOT: Readonly<Record<PadSync['kind'], StyleProp<ViewStyle>>> = {
  synced: [styles.dot, styles.synced],
  sending: [styles.dot, styles.sending],
  offline: [styles.dot, styles.trouble],
  refused: [styles.dot, styles.trouble],
};
