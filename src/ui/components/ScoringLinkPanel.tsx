import { memo, useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { seaznQrPlan } from '@/domain/qr/seaznQr';
import { SCORING_SHOW_SECONDS, type ScoringLinkView } from '@/hooks/useScoringLink';
import { useT } from '@/hooks/useLanguage';
import type { MessageKey } from '@/i18n/messages';
import type { ScoringWord } from '@/services/scoringLinkPort';
import { SeaznQr } from '@/ui/components/SeaznQr';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';

/** By literal and typed over every word: a new word is a compile error, and each key type-checks. */
const REFUSED: Readonly<Record<ScoringWord, MessageKey>> = {
  code_ended: 'stream.scoring.refused.codeEnded',
  replaced: 'stream.scoring.refused.replaced',
  match_finished: 'stream.scoring.refused.matchFinished',
  not_entitled: 'stream.scoring.refused.notEntitled',
  rate_limited: 'stream.scoring.refused.rateLimited',
  unavailable: 'stream.scoring.refused.unavailable',
};

type PanelProps = {
  readonly view: ScoringLinkView;
  /** B3: the whole seconds left before the panel hides itself, 10 down to 1 (the hook's tick). */
  readonly secondsLeft: number;
  readonly onHide: () => void;
};

/**
 * Spec §10, Q-C2: the code over the camera half, for at most 10 s. It is drawn over the shot on purpose and it is the
 * second thing that is (AGENTS §6); the controls half, Stop included, stays live beside it. The url goes to
 * `seaznQrPlan` and nowhere else, and the plan is made once per url, never per tick of the countdown.
 *
 * The owner's board (B3, B4): a cream ground with ink text, the QR on its own white quiet zone, and one bottom row
 * with the countdown bar, "Hides in {n} s" and Hide. An asking panel has nothing to count, so its row is Hide alone.
 */
export const ScoringLinkPanel = memo(function ScoringLinkPanel({
  view,
  secondsLeft,
  onHide,
}: PanelProps) {
  const { t } = useT();
  const url = view.kind === 'shown' ? view.url : null;
  const plan = useMemo(() => (url === null ? null : seaznQrPlan(url)), [url]);
  if (view.kind === 'hidden') return null;
  const counting = view.kind === 'shown' || view.kind === 'refused';
  return (
    <View testID="scoring-panel" style={styles.panel}>
      <Text variant="panelTitle" style={styles.title}>
        {t('stream.scoring.title')}
      </Text>
      {plan === null ? null : (
        <>
          <SeaznQr plan={plan} size={layout.qrSize} label={t('stream.scoring.code')} />
          <Text variant="metricUnit" style={styles.ink}>
            {t('stream.scoring.hint')}
          </Text>
        </>
      )}
      {view.kind === 'asking' ? (
        <Text variant="body" style={styles.sentence}>
          {t('stream.scoring.asking')}
        </Text>
      ) : null}
      {view.kind === 'refused' ? (
        <Text variant="body" style={styles.sentence}>
          {view.word === 'rate_limited'
            ? view.retryAfterS === null
              ? t(REFUSED.unavailable) // no number to say: the generic "try again"
              : t(REFUSED.rate_limited, { seconds: view.retryAfterS })
            : t(REFUSED[view.word])}
        </Text>
      ) : null}
      <View testID="scoring-bottom" style={styles.bottom}>
        {counting ? (
          <>
            <View testID="scoring-bar" style={styles.track}>
              <View testID="scoring-bar-fill" style={fillFor(secondsLeft)} />
            </View>
            <Text
              testID="scoring-countdown"
              variant="metricUnit"
              numberOfLines={1}
              style={styles.countdown}
            >
              {t('stream.scoring.hidesIn', { seconds: secondsLeft })}
            </Text>
          </>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('stream.scoring.hide')}
          onPress={onHide}
          style={styles.hide}
        >
          <Text variant="control" style={styles.ink}>
            {t('stream.scoring.hide')}
          </Text>
        </Pressable>
      </View>
    </View>
  );
});

/**
 * The bar's fill at each whole second left: a tenth of the track a second (the board: remaining / 10). Made once,
 * so a tick allocates no style (a style object is never written inline).
 */
const FILLS = Array.from(
  { length: SCORING_SHOW_SECONDS },
  (_, at) =>
    StyleSheet.create({
      fill: {
        width: `${((at + 1) * 100) / SCORING_SHOW_SECONDS}%`,
        height: '100%',
        backgroundColor: colour.ground,
      },
    }).fill,
);

function fillFor(secondsLeft: number) {
  const whole = Math.min(Math.max(Math.round(secondsLeft), 1), SCORING_SHOW_SECONDS);
  return FILLS[whole - 1];
}

const styles = StyleSheet.create({
  // The board's panel: the camera half's whole area, cream (`ink` is the app's cream, #f5f0e8, here a ground), with
  // the night ink (`ground`) for everything on it. The QR keeps its own white quiet zone (`qrGround`).
  panel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: layout.controlsGap,
    padding: layout.controlsPad,
    backgroundColor: colour.ink,
  },
  // Every Text role carries a colour made for the night ground; on the cream one the ink is the night.
  ink: { color: colour.ground },
  // The board's title is left-aligned in a panel whose other children are centred: it takes the full width.
  title: { color: colour.ground, alignSelf: 'stretch', textAlign: 'left' },
  sentence: { color: colour.ground, textAlign: 'center' },
  // One row: bar, text, Hide. The bar takes what the other two leave (scoringFit.test.ts keeps it at least 32 dp).
  bottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    alignSelf: 'stretch',
    gap: layout.controlsGap,
  },
  track: {
    flex: 1,
    height: layout.scoringBar,
    borderRadius: layout.scoringBar / 2,
    overflow: 'hidden',
    backgroundColor: colour.panelTrack,
  },
  // Tabular figures keep "10" and "9" from jittering the bar beside them.
  countdown: { color: colour.ground, fontVariant: ['tabular-nums'] },
  hide: {
    minHeight: layout.iconButton,
    minWidth: layout.iconButton,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderWidth: layout.iconBorder,
    borderColor: colour.ground,
    borderRadius: radius.card,
  },
});
