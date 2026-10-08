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
  /**
   * The match label's height after each layout, and 0 when the label goes or changes (`MatchLabel`'s
   * `onLayoutHeight`), said to the camera half, which sizes the picture from it (owner, 2026-10-08, option A). The
   * strip reports nothing else: its own height, the round line and the caption are not inputs to the picture.
   */
  readonly onLabelHeight?: (height: number) => void;
};

/**
 * Under the camera box (spec §1), top to bottom: the round line when there is one and it fits (spec §2,
 * R-F5), the match label, the status line, and one advisory caption when there is one. Solid surface, in the flow
 * below the shot: nothing here is drawn over the preview (AGENTS §6, D17).
 * Every reservation is a token, so the fit arithmetic and this read one number. The label is the one thing measured:
 * the camera half sizes the picture from its height (`stripReserve`), and the round line asks whether the strip has
 * room for it with a caption up or not (`stageFits`).
 */
export const StatusStrip = memo(function StatusStrip({
  line,
  advisory,
  onLabelHeight,
}: StatusStripProps) {
  const { t } = useT();
  const stage = useEngineSelector(selectStageLine);
  // R-F5: the round line yields. The strip and the label say how tall they came out; 0 is not measured yet.
  const [stripHeight, setStripHeight] = useState(0);
  const [labelHeight, setLabelHeight] = useState(0);
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => setStripHeight(event.nativeEvent.layout.height),
    [],
  );
  const onLabel = useCallback(
    (height: number) => {
      setLabelHeight(height);
      onLabelHeight?.(height);
    },
    [onLabelHeight],
  );
  return (
    <View testID="status-strip" style={styles.strip} onLayout={onLayout}>
      {stage !== null && stageFits(stripHeight, labelHeight, advisory !== null) ? (
        <StageLine text={stage} />
      ) : null}
      <MatchLabel onLayoutHeight={onLabel} />
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
