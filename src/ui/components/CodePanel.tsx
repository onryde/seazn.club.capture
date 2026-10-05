import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { CodeError } from '@/domain/credentials/waitingFields';
import type { ModeCode } from '@/domain/mode/Mode';
import type { UnpairReason } from '@/domain/session/Pairing';
import type { HomePanel } from '@/hooks/useHome';
import { useT } from '@/hooks/useLanguage';
import type { MessageKey } from '@/i18n/messages';
import { MODE_NAME } from '@/i18n/modeNames';
import type { Translator } from '@/i18n/translate';
import { Button } from '@/ui/components/Button';
import { GhostButton } from '@/ui/components/GhostButton';
import { SlideUpSheet } from '@/ui/components/SlideUpSheet';
import { Text } from '@/ui/components/Text';
import { colour, radius, space } from '@/ui/theme/tokens';

type Copy = {
  readonly title: string;
  readonly body: string | null;
  readonly open: string | null;
  /** Try again: only when there was no connection (D27). */
  readonly retry: boolean;
  /** False only while checking: neither the dim nor Back closes it. */
  readonly closable: boolean;
  /** Scan again from the same tile: every settled panel, never while checking or on A7's sheet. */
  readonly scanAgain: boolean;
  /** A7's sheet only: the button that keeps the pairing. The dim means it too, under its name. */
  readonly cancel: string | null;
};

/** A panel that has said its piece: Scan again, and the dim closes it. */
const settled = (title: string, body: string | null, open: string | null = null): Copy => ({
  title,
  body,
  open,
  retry: false,
  closable: true,
  scanAgain: true,
  cancel: null,
});

/** Every outcome, in the operator's words (decisions 3 and 10). Never "Invalid code". */
function panelCopy(outcome: HomePanel, t: Translator['t'], time: string | null): Copy {
  switch (outcome.kind) {
    case 'otherMode': {
      const mode = t(MODE_NAME[outcome.code.mode]);
      return settled(
        t('panel.otherMode.title', { mode }),
        null,
        t('panel.otherMode.open', { mode }),
      );
    }
    case 'comingSoon': {
      const mode = t(MODE_NAME[outcome.mode]);
      return settled(t('panel.comingSoon.title', { mode }), t('panel.comingSoon.body', { mode }));
    }
    case 'expired':
      return settled(t('panel.expired.title'), t('panel.expired.body', { time: time ?? '' }));
    case 'newerVersion':
      return settled(t('panel.newerVersion.title'), t('panel.newerVersion.body'));
    case 'seaznPage':
      return settled(t('panel.seaznPage.title'), t('panel.seaznPage.body'));
    case 'foreign':
      return settled(t('panel.foreign.title'), t('panel.foreign.body'));
    case 'checking':
      return {
        title: t('panel.checking.title'),
        body: null,
        open: null,
        retry: false,
        closable: false,
        scanAgain: false,
        cancel: null,
      };
    case 'codeError':
      return codeCopy(outcome.error, t);
    case 'unpaired':
      return settled(t(UNPAIRED[outcome.reason].title), t(UNPAIRED[outcome.reason].body));
    // A7's sheet has the spec's two answers and no others (review C5 I-3): no
    // Scan again, and the dim (and Back) mean Cancel, which sends nothing.
    case 'unpairConfirm': {
      const mode = t(MODE_NAME[outcome.code.mode]);
      return {
        title: t('sheet.unpair.body', { mode }),
        body: null,
        open: t('sheet.unpair.confirm'),
        retry: false,
        closable: true,
        scanAgain: false,
        cancel: t('sheet.unpair.cancel'),
      };
    }
  }
}

/** Amendment §2, Unpaired without asking: why native left the pairing. */
const UNPAIRED: Readonly<Record<UnpairReason, { title: MessageKey; body: MessageKey }>> = {
  'code-ended': { title: 'panel.codeEnded.title', body: 'panel.codeEnded.body' },
  replaced: { title: 'panel.replaced.title', body: 'panel.replaced.body' },
  taken: { title: 'panel.taken.title', body: 'panel.taken.body' },
  permissions: { title: 'panel.permissions.title', body: 'panel.permissions.body' },
};

/**
 * Spec §1's table, with a short title over the spec's sentence (D27). The code
 * answer names no end reason, so an ended code reads as one that does not work
 * (amendment §2: "the two 410 lines go").
 */
function codeCopy(error: CodeError, t: Translator['t']): Copy {
  const plain = (title: MessageKey, body: MessageKey): Copy => settled(t(title), t(body));
  switch (error.kind) {
    case 'invalid':
    case 'not-found':
    case 'ended':
      return plain('panel.codeInvalid.title', 'panel.codeInvalid.body');
    case 'offline':
      return {
        ...plain('panel.descriptor.offline.title', 'panel.descriptor.offline.body'),
        retry: true,
      };
    case 'rate-limited':
      return settled(
        t('panel.descriptor.busy.title'),
        t('panel.descriptor.busy.body', { n: error.retryAfterS }),
      );
  }
}

type CodePanelProps = {
  outcome: HomePanel;
  time: string | null;
  onOpen: (code: ModeCode) => void;
  onScanAgain: () => void;
  onClose: () => void;
  onTryAgain: () => void;
  /** A7's sheet: Unpair & open. */
  onConfirmUnpair: () => void;
  /** A7's sheet: Cancel. */
  onCancelUnpair: () => void;
};

/**
 * Slides up over a dimmed Home; tapping the dim closes it, except while the
 * code is being checked (D27). The sheet is modal to a screen reader, so
 * focus stays on the panel, not on Home beneath it.
 * Both props are needed: native reads `accessibilityViewIsModal` (RN 0.86's
 * View does not map `aria-modal`), and react-native-web reads `aria-modal`.
 */
export const CodePanel = memo(function CodePanel(props: CodePanelProps) {
  const { t } = useT();
  const { outcome, onOpen, onConfirmUnpair } = props;
  const copy = panelCopy(outcome, t, props.time);
  const open = useCallback(() => {
    if (outcome.kind === 'otherMode') onOpen(outcome.code);
    if (outcome.kind === 'unpairConfirm') onConfirmUnpair();
  }, [outcome, onOpen, onConfirmUnpair]);
  return (
    <View style={styles.overlay}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={copy.cancel ?? t('panel.close')}
        onPress={copy.cancel === null ? props.onClose : props.onCancelUnpair}
        disabled={!copy.closable}
        style={styles.dim}
      />
      <SlideUpSheet accessibilityViewIsModal aria-modal style={styles.sheet}>
        <Text variant="metricUnit">
          {t('panel.opened', { mode: t(MODE_NAME[outcome.tapped]) })}
        </Text>
        <Text variant="title">{copy.title}</Text>
        {copy.body === null ? null : <Text variant="body">{copy.body}</Text>}
        {copy.open === null ? null : <Button label={copy.open} onPress={open} />}
        {copy.cancel === null ? null : (
          <GhostButton label={copy.cancel} onPress={props.onCancelUnpair} />
        )}
        {copy.retry ? <Button label={t('panel.tryAgain')} onPress={props.onTryAgain} /> : null}
        {copy.scanAgain ? (
          <GhostButton label={t('panel.scanAgain')} onPress={props.onScanAgain} />
        ) : null}
      </SlideUpSheet>
    </View>
  );
});

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end' },
  dim: { ...StyleSheet.absoluteFill, backgroundColor: colour.ground, opacity: 0.7 },
  sheet: {
    gap: space.sm,
    padding: space.md,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    backgroundColor: colour.surface2,
  },
});
