import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { ADVISORY_KEY, type Advisory } from '@/hooks/advisory';
import { selectStageLine } from '@/hooks/engineSelectors';
import type { LineTier } from '@/hooks/statusKey';
import { useEngineSelector } from '@/hooks/useCaptureEngine';
import { useT } from '@/hooks/useLanguage';
import { MatchLabel } from '@/ui/components/MatchLabel';
import { StageLine } from '@/ui/components/StageLine';
import { StatusLine } from '@/ui/components/StatusLine';
import { Text } from '@/ui/components/Text';
import { colour, layout } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

type StatusStripProps = {
  /** The one true sentence (the status line, or Back's refusal over a calm one). */
  readonly line: string;
  /**
   * Which tier that line is (`LINE_TIER`, owner ruling 2026-10-08): an URGENT line (a refusal, trouble, a stopped
   * stream, Back's "hold Stop") always wins the one message line; a ROUTINE one gives way to a caption.
   */
  readonly lineTier: LineTier;
  /** The one caption at a time (`topAdvisory`), or none. */
  readonly advisory: Advisory | null;
  /**
   * The match label's height after each layout, and 0 when the label goes or changes (`MatchLabel`'s
   * `onLayoutHeight`), said to the camera half, which sizes the picture from it (owner, 2026-10-08, option A). The
   * strip reports nothing else: the round line and the caption are not inputs to the picture.
   */
  readonly onLabelHeight?: (height: number) => void;
};

/**
 * Under the camera box (spec §1), top to bottom: the round line whenever the match has one (spec §2; owner, 2026-10-08,
 * option B: always shown, its room is in the reserve), the match label, and ONE message line (owner, 2026-10-08, "one
 * single line all the time"): never both, always exactly one line (an ellipsis if it is longer than the strip's text).
 * Two tiers decide which: a status line that needs action or reports a failure is URGENT and always wins; an advisory
 * caption beats only a ROUTINE status line (`LINE_TIER`). Solid surface, in the flow below the shot: nothing here is
 * drawn over the preview (AGENTS §6, D17).
 * Every reservation is a token, so the fit arithmetic and this read one number. The label is the one thing measured:
 * the camera half sizes the picture from its height (`stripReserve`), which holds the round line's room.
 */
export const StatusStrip = memo(function StatusStrip({
  line,
  lineTier,
  advisory,
  onLabelHeight,
}: StatusStripProps) {
  const { t } = useT();
  const stage = useEngineSelector(selectStageLine);
  return (
    <View testID="status-strip" style={styles.strip}>
      {stage !== null ? <StageLine text={stage} /> : null}
      <MatchLabel onLayoutHeight={onLabelHeight} />
      {/* One line of body height either way, so the strip is the same height whichever it says. */}
      <View testID="strip-message" style={styles.message}>
        {advisory !== null && lineTier === 'routine' ? (
          <Text variant="metricUnit" numberOfLines={layout.messageLines}>
            {t(ADVISORY_KEY[advisory])}
          </Text>
        ) : (
          <StatusLine variant="body" numberOfLines={layout.messageLines}>
            {line}
          </StatusLine>
        )}
      </View>
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
  // The message line's room, a line of body whether it says the status line (body) or a caption (metricUnit, centred in it).
  message: {
    minHeight: layout.messageLines * typeScale.body.lineHeight,
    justifyContent: 'center',
  },
});
