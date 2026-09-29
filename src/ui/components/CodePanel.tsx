import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { ModeCode } from '@/domain/mode/Mode';
import type { ScanOutcome } from '@/domain/mode/scanOutcome';
import { useT } from '@/hooks/useLanguage';
import { MODE_NAME } from '@/i18n/modeNames';
import type { Translator } from '@/i18n/translate';
import { Button } from '@/ui/components/Button';
import { GhostButton } from '@/ui/components/GhostButton';
import { SlideUpSheet } from '@/ui/components/SlideUpSheet';
import { Text } from '@/ui/components/Text';
import { colour, radius, space } from '@/ui/theme/tokens';

export type PanelOutcome = Exclude<ScanOutcome, { kind: 'open' }>;

type Copy = { readonly title: string; readonly body: string | null; readonly open: string | null };

/** Every outcome, in the operator's words (decisions 3 and 10). Never "Invalid code". */
function panelCopy(outcome: PanelOutcome, t: Translator['t'], time: string | null): Copy {
  switch (outcome.kind) {
    case 'otherMode': {
      const mode = t(MODE_NAME[outcome.code.mode]);
      return {
        title: t('panel.otherMode.title', { mode }),
        body: null,
        open: t('panel.otherMode.open', { mode }),
      };
    }
    case 'comingSoon': {
      const mode = t(MODE_NAME[outcome.mode]);
      return {
        title: t('panel.comingSoon.title', { mode }),
        body: t('panel.comingSoon.body', { mode }),
        open: null,
      };
    }
    case 'expired':
      return {
        title: t('panel.expired.title'),
        body: t('panel.expired.body', { time: time ?? '' }),
        open: null,
      };
    case 'newerVersion':
      return {
        title: t('panel.newerVersion.title'),
        body: t('panel.newerVersion.body'),
        open: null,
      };
    case 'seaznPage':
      return { title: t('panel.seaznPage.title'), body: t('panel.seaznPage.body'), open: null };
    case 'foreign':
      return { title: t('panel.foreign.title'), body: t('panel.foreign.body'), open: null };
  }
}

type CodePanelProps = {
  outcome: PanelOutcome;
  time: string | null;
  onOpen: (code: ModeCode) => void;
  onScanAgain: () => void;
  onClose: () => void;
};

/**
 * Slides up over a dimmed Home; tapping the dim closes it. The sheet is modal
 * to a screen reader, so focus stays on the panel, not on Home beneath it.
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
        style={styles.dim}
      />
      <SlideUpSheet aria-modal style={styles.sheet}>
        <Text variant="metricUnit">
          {t('panel.opened', { mode: t(MODE_NAME[outcome.tapped]) })}
        </Text>
        <Text variant="title">{copy.title}</Text>
        {copy.body === null ? null : <Text variant="body">{copy.body}</Text>}
        {copy.open === null ? null : <Button label={copy.open} onPress={open} />}
        <GhostButton label={t('panel.scanAgain')} onPress={props.onScanAgain} />
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
