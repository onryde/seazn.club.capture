import { memo, useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ScoringCurrent, ScoringLeftover } from '@/domain/mode/scoringHome';
import { useT } from '@/hooks/useLanguage';
import type { Translator } from '@/i18n/translate';
import { Button } from '@/ui/components/Button';
import { rowCardPadding, type CardShape } from '@/ui/components/cardShape';
import { GhostButton } from '@/ui/components/GhostButton';
import { Text } from '@/ui/components/Text';
import { colour, radius, space } from '@/ui/theme/tokens';

/**
 * Home's Remote Scoring cards (plan S2-1 Task 10; design §5, §6.3, ruling 29). What each says is `scoringHome`'s
 * decision; the words are here, in the order the operator needs them: which match, what is unsent, what to do. A live
 * queue is only counted, because it is still sending; a queue that can never send, or cannot be read, is told to the
 * organiser, in orange (a failure reads orange, never red), and can be dismissed. No card asks before it dismisses.
 */

/** The sentence under a match's name: what is unsent and what that means; null when there is nothing to say. */
function currentSentence(current: ScoringCurrent, t: Translator): string | null {
  if (current.state === 'unreadable') return t.t('home.scoring.unreadable');
  if (current.unsent === 0) return null;
  const key = current.state === 'dead' ? 'home.scoring.deadHere' : 'home.scoring.unsent';
  return t.tp(key, current.unsent);
}

/**
 * Forget when nothing is unsent, Dismiss when the taps can never go, nothing while they are still sending: a Dismiss
 * on a live queue would discard taps that are about to be sent (ruling 29).
 */
function removeLabel(current: ScoringCurrent, t: Translator): string | null {
  if (current.state !== 'live') return t.t('home.scoring.dismiss');
  return current.unsent === 0 ? t.t('home.continue.forget') : null;
}

type ContinueProps = {
  current: ScoringCurrent;
  layout?: CardShape;
  onContinue: () => void;
  onRemove: (fixtureId: string) => void;
};

/** The saved match: Continue opens the pad; the second button lets the match go when it holds nothing that can send. */
export const ScoringContinueCard = memo(function ScoringContinueCard(props: ContinueProps) {
  const translator = useT();
  const { current, onRemove } = props;
  const removePress = useCallback(() => onRemove(current.fixtureId), [onRemove, current.fixtureId]);
  const sentence = currentSentence(current, translator);
  const remove = removeLabel(current, translator);
  const failing = current.state !== 'live';
  const text = (
    <View style={props.layout === 'row' ? rowStyles.text : styles.text}>
      <Text variant="state" style={styles.title}>
        {translator.t('home.continue.title', { mode: translator.t('mode.scoring') })}
      </Text>
      {current.label === '' ? null : (
        <Text variant="control" style={styles.line}>
          {current.label}
        </Text>
      )}
      {sentence === null ? null : (
        <Text variant="control" style={failing ? styles.failing : styles.line}>
          {sentence}
        </Text>
      )}
    </View>
  );
  const actions = (
    <View testID="scoring-actions" style={styles.actions}>
      <Button label={translator.t('home.continue.open')} onPress={props.onContinue} />
      {remove === null ? null : <GhostButton label={remove} onPress={removePress} />}
    </View>
  );
  const edge = failing ? styles.edgeFailing : styles.edge;
  return props.layout === 'row' ? (
    <View testID="scoring-continue" style={[rowStyles.card, edge]}>
      {text}
      {actions}
    </View>
  ) : (
    <View testID="scoring-continue" style={[styles.card, edge]}>
      {text}
      {actions}
    </View>
  );
});

type LeftoverProps = {
  leftover: ScoringLeftover;
  layout?: CardShape;
  onDismiss: (fixtureId: string) => void;
};

/** Another match's taps. Still sending: counted, with nothing to do. Dead or unreadable: told, with Dismiss. */
export const ScoringLeftoverCard = memo(function ScoringLeftoverCard(props: LeftoverProps) {
  const translator = useT();
  const { leftover, onDismiss } = props;
  const dismissPress = useCallback(
    () => onDismiss(leftover.fixtureId),
    [onDismiss, leftover.fixtureId],
  );
  const match = leftover.kind === 'unreadable' ? '' : leftover.label;
  const sentence = leftoverSentence(leftover, match, translator);
  const failing = leftover.kind !== 'live';
  const text = (
    <View style={props.layout === 'row' ? rowStyles.text : styles.text}>
      {leftover.kind === 'dead' && match !== '' ? (
        <Text variant="state" style={styles.title}>
          {match}
        </Text>
      ) : null}
      <Text variant="control" style={failing ? styles.failing : styles.line}>
        {sentence}
      </Text>
    </View>
  );
  const dismiss = failing ? (
    <GhostButton label={translator.t('home.scoring.dismiss')} onPress={dismissPress} />
  ) : null;
  const edge = failing ? styles.edgeFailing : styles.edgeQuiet;
  return props.layout === 'row' ? (
    <View testID="scoring-leftover" style={[rowStyles.card, edge]}>
      {text}
      {dismiss}
    </View>
  ) : (
    <View testID="scoring-leftover" style={[styles.card, edge]}>
      {text}
      {dismiss}
    </View>
  );
});

function leftoverSentence(
  leftover: ScoringLeftover,
  match: string,
  translator: Translator,
): string {
  if (leftover.kind === 'unreadable') return translator.t('home.scoring.unreadable');
  if (leftover.kind === 'dead') return translator.tp('home.scoring.deadHere', leftover.unsent);
  const name = match === '' ? translator.t('home.scoring.matchFallback') : match;
  return translator.tp('home.scoring.elsewhere', leftover.unsent, { match: name });
}

const styles = StyleSheet.create({
  card: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    backgroundColor: colour.surface,
  },
  edge: { borderColor: colour.lime },
  edgeQuiet: { borderColor: colour.ink3 },
  edgeFailing: { borderColor: colour.caution },
  text: { gap: space.xs },
  // The `state` and `control` roles set no colour, and the platform default is black, which is invisible on `surface`.
  title: { color: colour.ink },
  line: { color: colour.ink },
  failing: { color: colour.caution },
  // Wraps: the 200 dp plate and a second button are wider than the card at 320 dp, and in nl/es at 360 (scoringHomeFit).
  actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
});

const rowStyles = StyleSheet.create({
  card: {
    ...rowCardPadding,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    backgroundColor: colour.surface,
  },
  // The words take what the buttons leave and wrap inside it, never behind them.
  text: { flex: 1, minWidth: 0, gap: space.xs },
});
