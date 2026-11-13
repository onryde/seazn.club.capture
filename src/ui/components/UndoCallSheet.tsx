import { memo } from 'react';
import { Pressable, View } from 'react-native';
import { useT } from '@/hooks/useLanguage';
import { Button } from '@/ui/components/Button';
import { GhostButton } from '@/ui/components/GhostButton';
import { padSheet } from '@/ui/components/padSheet';
import { Text } from '@/ui/components/Text';

/**
 * Undo call's question (S4 design §7a): "Undo call?" and "{match} goes back to where it was". No hold: a call can be made
 * again. Keep is the lime plate and first, as Stay is on Exit, and the dim means Keep; Undo call is the outline, so a
 * thumb on the plate never undoes. While the request is out both wait. A plain View on the pad's sheet shape; the
 * caller's `useBackCloses` makes Back mean Keep.
 */
export const UndoCallSheet = memo(function UndoCallSheet({
  match,
  court,
  called,
  busy,
  onKeep,
  onUndo,
}: {
  /** "Ng v Brown": the match whose call is undone. */
  readonly match: string;
  /** The court it is called to. */
  readonly court: string;
  /** The latest read of the day still shows that match called on that court; when it stops, the sheet says so and offers Close. */
  readonly called: boolean;
  readonly busy: boolean;
  readonly onKeep: () => void;
  readonly onUndo: () => void;
}) {
  const { t } = useT();
  return (
    <View style={padSheet.overlay}>
      <Pressable
        testID="undo-call-dim"
        aria-hidden
        importantForAccessibility="no-hide-descendants"
        onPress={onKeep}
        style={padSheet.dim}
      />
      <View testID="undo-call-confirm" accessibilityViewIsModal aria-modal style={padSheet.sheet}>
        <Text variant="title">{t('matchday.call.undoTitle')}</Text>
        {called || busy ? (
          <Asking match={match} busy={busy} onKeep={onKeep} onUndo={onUndo} />
        ) : (
          <Gone court={court} onClose={onKeep} />
        )}
      </View>
    </View>
  );
});

const Asking = memo(function Asking({
  match,
  busy,
  onKeep,
  onUndo,
}: {
  readonly match: string;
  readonly busy: boolean;
  readonly onKeep: () => void;
  readonly onUndo: () => void;
}) {
  const { t } = useT();
  return (
    <>
      <Text variant="body">{t('matchday.call.undoBody', { match })}</Text>
      <Button label={t('matchday.call.keep')} onPress={onKeep} disabled={busy} />
      <GhostButton label={t('matchday.call.undo')} onPress={onUndo} disabled={busy} />
    </>
  );
});

/** The court is not calling this match any more (it started, or the desk moved it): nothing to undo, only Close. */
const Gone = memo(function Gone({
  court,
  onClose,
}: {
  readonly court: string;
  readonly onClose: () => void;
}) {
  const { t } = useT();
  return (
    <>
      <Text variant="body" testID="undo-call-gone">
        {t('matchday.call.undoGone', { court })}
      </Text>
      <Button label={t('matchday.call.close')} onPress={onClose} />
    </>
  );
});
