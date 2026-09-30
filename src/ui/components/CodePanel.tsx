import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { endedByTimeout, type DescriptorError } from '@/domain/credentials/SessionDescriptor';
import type { ModeCode } from '@/domain/mode/Mode';
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
  /** False only while checking: no Scan again, and neither the dim nor Back closes it. */
  readonly closable: boolean;
};

/** A panel that has said its piece: Scan again, and the dim closes it. */
const settled = (title: string, body: string | null, open: string | null = null): Copy => ({
  title,
  body,
  open,
  retry: false,
  closable: true,
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
      };
    case 'descriptorError':
      return descriptorCopy(outcome.error, t);
  }
}

/** Spec §1's table, with a short title over the spec's sentence (D27). */
function descriptorCopy(error: DescriptorError, t: Translator['t']): Copy {
  const plain = (title: MessageKey, body: MessageKey): Copy => settled(t(title), t(body));
  switch (error.kind) {
    case 'invalid':
    case 'not-found':
      return plain('panel.descriptor.invalid.title', 'panel.descriptor.invalid.body');
    case 'ended':
      return endedByTimeout(error.endReason)
        ? plain('panel.descriptor.timedOut.title', 'panel.descriptor.timedOut.body')
        : plain('panel.descriptor.endedOrganiser.title', 'panel.descriptor.endedOrganiser.body');
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
  const { outcome, onOpen } = props;
  const copy = panelCopy(outcome, t, props.time);
  const open = useCallback(() => {
    if (outcome.kind === 'otherMode') onOpen(outcome.code);
  }, [outcome, onOpen]);
  return (
    <View style={styles.overlay}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('panel.close')}
        onPress={props.onClose}
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
        {copy.retry ? <Button label={t('panel.tryAgain')} onPress={props.onTryAgain} /> : null}
        {copy.closable ? (
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
