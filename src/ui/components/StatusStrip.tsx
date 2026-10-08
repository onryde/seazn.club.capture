import { memo, useCallback, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { ADVISORY_KEY, type Advisory } from '@/hooks/advisory';
import { selectStageLine } from '@/hooks/engineSelectors';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { useT } from '@/hooks/useLanguage';
import { MatchLabel } from '@/ui/components/MatchLabel';
import { StageLine } from '@/ui/components/StageLine';
import { StatusLine } from '@/ui/components/StatusLine';
import { Text } from '@/ui/components/Text';
import { stageFits } from '@/ui/theme/stageFit';
import { colour, layout } from '@/ui/theme/tokens';

type StatusStripProps = {
  /** The one true sentence (the status line, or Back's refusal over a calm one). */
  readonly line: string;
  /** The one caption at a time (`topAdvisory`), or none. */
  readonly advisory: Advisory | null;
};

/**
 * Under the camera box (spec §1), top to bottom: the round line when there is one and it fits (spec §2,
 * R-F5), the match label, the status line, and one advisory caption when there is one. Solid surface, in the flow
 * below the shot: nothing here is drawn over the preview (AGENTS §6, D17).
 * Every reservation is a token, so the fit arithmetic and this read one number.
 */
export const StatusStrip = memo(function StatusStrip({ line, advisory }: StatusStripProps) {
  const { t } = useT();
  const stage = useEngineSelector(selectStageLine);
  // R-F5: the round line yields. The strip and the label say how tall they came out; 0 is not measured yet.
  const [stripHeight, setStripHeight] = useState(0);
  const [labelHeight, setLabelHeight] = useState(0);
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => setStripHeight(event.nativeEvent.layout.height),
    [],
  );
  return (
    <View testID="status-strip" style={styles.strip} onLayout={onLayout}>
      {stage !== null && stageFits(stripHeight, labelHeight) ? <StageLine text={stage} /> : null}
      <MatchLabel onLayoutHeight={setLabelHeight} />
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
