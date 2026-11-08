import { memo, useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { CricketStep, CricketStepOption } from '@/domain/scoring/cricketTypes';
import { useT } from '@/hooks/useLanguage';
import { usePadText } from '@/hooks/usePadText';
import type { MessageKey } from '@/i18n/messages';
import { GhostButton } from '@/ui/components/GhostButton';
import { padSheet } from '@/ui/components/padSheet';
import { sheetRow, sheetRowLabel, sheetRowStyles, sheetRowTone } from '@/ui/components/sheetRow';
import { StepRow, type StepOption } from '@/ui/components/StepSheet';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

/**
 * A cricket sheet's step (S2-4 plan Tasks 11 to 15): the domain's step (`CricketStep`) in the operator's language, over the
 * pad. Choices in a group (an extra's runs: "Runs run", "Off the bat") are a row of keys under the group's name; any
 * other is a full-width row (the kit's `StepRow`, rulings 82 and 85). The choices scroll when they are taller than the
 * room (eleven fielders), and Cancel stays under them. Cancel, the dim and Back close it with nothing recorded; there is
 * no timer. A sheet that stands by itself (the over-end sheet) names its own way back (`cancelKey`: "Undo last ball"),
 * or has none (`onCancel` null), and then the dim takes no tap. Modal to a screen reader: native reads
 * `accessibilityViewIsModal`, react-native-web `aria-modal`.
 */
export const CricketStepSheet = memo(function CricketStepSheet({
  step,
  onChoose,
  onCancel,
  cancelKey = 'scoring.sheet.cancel',
}: {
  readonly step: CricketStep;
  readonly onChoose: (id: string) => void;
  readonly onCancel: (() => void) | null;
  readonly cancelKey?: MessageKey;
}) {
  const { t } = useT();
  const words = usePadText();
  const parts = useMemo(() => partsOf(step.options), [step.options]);
  return (
    <View style={padSheet.overlay}>
      <Pressable aria-hidden onPress={onCancel ?? undefined} style={padSheet.dim} />
      <View
        testID="step-sheet"
        accessibilityViewIsModal
        aria-modal
        style={[padSheet.sheet, styles.sheet]}
      >
        <Text variant="title" accessibilityRole="header">
          {words(step.title)}
        </Text>
        {step.body === null ? null : <Text variant="body">{words(step.body)}</Text>}
        <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
          {parts.map((part) => (
            <StepPart key={part.key} part={part} onChoose={onChoose} />
          ))}
        </ScrollView>
        {onCancel === null ? null : <GhostButton label={t(cancelKey)} onPress={onCancel} />}
      </View>
    </View>
  );
});

/** A run of choices in one group (a row of keys), or one full-width row. */
type Part = {
  readonly key: string;
  readonly group: MessageKey | null;
  readonly options: readonly CricketStepOption[];
};

/** The step's choices in order, those of a group gathered into its row. */
function partsOf(options: readonly CricketStepOption[]): readonly Part[] {
  const parts: Part[] = [];
  for (const option of options) {
    const group = option.group ?? null;
    const last = parts.at(-1);
    if (group !== null && last?.group === group) {
      parts[parts.length - 1] = { ...last, options: [...last.options, option] };
    } else {
      parts.push({ key: option.id, group, options: [option] });
    }
  }
  return parts;
}

const StepPart = memo(function StepPart({
  part,
  onChoose,
}: {
  readonly part: Part;
  readonly onChoose: (id: string) => void;
}) {
  const { t } = useT();
  if (part.group === null) {
    return (
      <>
        {part.options.map((option) => (
          <WordRow key={option.id} option={option} onChoose={onChoose} />
        ))}
      </>
    );
  }
  const name = t(part.group);
  return (
    <View testID={`group-${part.group}`} style={styles.group}>
      <Text variant="metricUnit" style={styles.groupName}>
        {name}
      </Text>
      <View style={styles.keys}>
        {part.options.map((option) => (
          <KeyCell key={option.id} option={option} group={name} onChoose={onChoose} />
        ))}
      </View>
    </View>
  );
});

/** A full-width row: the kit's, its words in the operator's language. */
const WordRow = memo(function WordRow({
  option,
  onChoose,
}: {
  readonly option: CricketStepOption;
  readonly onChoose: (id: string) => void;
}) {
  const words = usePadText();
  const shown = useMemo<StepOption>(
    () => ({
      id: option.id,
      label: words(option.label),
      tone: option.tone,
      disabled: option.disabled,
      chosen: option.chosen,
      note: option.note == null ? null : words(option.note),
    }),
    [option, words],
  );
  return <StepRow option={shown} onChoose={onChoose} />;
});

/** A key in a group's row: its label large; a screen reader hears the group too ("Runs run: 2"). */
const KeyCell = memo(function KeyCell({
  option,
  group,
  onChoose,
}: {
  readonly option: CricketStepOption;
  readonly group: string;
  readonly onChoose: (id: string) => void;
}) {
  const words = usePadText();
  const press = useCallback(() => onChoose(option.id), [onChoose, option.id]);
  const off = option.disabled === true;
  const tone = sheetRowTone({ disabled: off, chosen: option.chosen });
  const label = words(option.label);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${group}: ${label}`}
      disabled={off}
      onPress={press}
      style={KEY[tone]}
    >
      <Text variant="action" style={sheetRowLabel[tone]}>
        {label}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  sheet: { maxHeight: '90%' },
  scroll: { flexGrow: 0, flexShrink: 1 },
  content: { gap: space.sm },
  group: { gap: space.xs },
  groupName: { color: colour.ink2 },
  keys: { flexDirection: 'row', gap: space.sm },
  key: { flex: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: 0 },
});

const KEY = sheetRowStyles([sheetRow.row, styles.key]);
