import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ADVISORY_KEY, type Advisory } from '@/hooks/advisory';
import { useT } from '@/hooks/useLanguage';
import { MatchLabel } from '@/ui/components/MatchLabel';
import { StatusLine } from '@/ui/components/StatusLine';
import { Text } from '@/ui/components/Text';
import { colour, layout } from '@/ui/theme/tokens';

type StatusStripProps = {
  /** The one true sentence (the status line, or Back's refusal over a calm one). */
  readonly line: string;
  /** The one caption at a time (`topAdvisory`), or none. */
  readonly advisory: Advisory | null;
};

/**
 * Under the camera box (spec §1), top to bottom: the match label, the status
 * line, and one advisory caption when there is one. Solid surface, in the flow
 * below the shot: nothing here is drawn over the preview (AGENTS §6, D17).
 * Every reservation is a token, so the fit arithmetic and this read one number.
 */
export const StatusStrip = memo(function StatusStrip({ line, advisory }: StatusStripProps) {
  const { t } = useT();
  return (
    <View testID="status-strip" style={styles.strip}>
      <MatchLabel />
      <StatusLine variant="body" numberOfLines={layout.statusLinesMax}>
        {line}
      </StatusLine>
      {advisory === null ? null : (
        <Text variant="metricUnit" numberOfLines={layout.captionLinesMax}>
          {t(ADVISORY_KEY[advisory])}
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  strip: {
    flex: 1,
    gap: layout.stripGap,
    paddingVertical: layout.stripPadV,
    paddingHorizontal: layout.stripPadH,
    backgroundColor: colour.surface,
  },
});
