import { memo, useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { CricketStep, CricketStepOption } from '@/domain/scoring/cricketTypes';
import { useT } from '@/hooks/useLanguage';
import { usePadText } from '@/hooks/usePadText';
import type { MessageKey } from '@/i18n/messages';
import { GhostButton } from '@/ui/components/GhostButton';
import { SheetFrame } from '@/ui/components/SheetFrame';
import { sheetRow, sheetRowLabel, sheetRowStyles, sheetRowTone } from '@/ui/components/sheetRow';
import { StepRow, type StepOption } from '@/ui/components/StepSheet';
import { Text } from '@/ui/components/Text';
import { colour, space } from '@/ui/theme/tokens';

/** A button under a sheet's choices besides its way back: its words' key and what it asks for. */
export type SheetButton = { readonly label: MessageKey; readonly onPress: () => void };

const NO_BUTTONS: readonly SheetButton[] = [];

/**
 * A cricket sheet's step (S2-4 plan Tasks 11 to 15): the domain's step (`CricketStep`) in the operator's language, over the
 * pad. Choices in a group (an extra's runs: "Runs run", "Off the bat") are a row of keys under the group's name; any
 * other is a full-width row (the kit's `StepRow`, rulings 82 and 85). The choices scroll when they are taller than the
 * room (eleven fielders), and the buttons stay under them. Cancel (`onCancel`, named by `cancelKey`), the dim (`onDim`)
 * and Back close it with nothing recorded; there is no timer. A sheet that stands by itself (the over-end sheet) has no
 * dim to close it (`onDim` null: a touch on it takes nothing) and names its own way back, or has none (`onCancel` null);
 * `also` are its other buttons, in a row above it. Modal to a screen reader (`SheetFrame`).
 */
export const CricketStepSheet = memo(function CricketStepSheet({
  step,
  onChoose,
  onDim,
  onCancel,
  cancelKey = 'scoring.sheet.cancel',
  also = NO_BUTTONS,
}: {
  readonly step: CricketStep;
  readonly onChoose: (id: string) => void;
  readonly onDim: (() => void) | null;
  readonly onCancel: (() => void) | null;
  readonly cancelKey?: MessageKey;
  readonly also?: readonly SheetButton[];
}) {
  const parts = useMemo(() => partsOf(step.options), [step.options]);
  return (
    <SheetFrame testID="step-sheet" dimTestID="step-dim" onDim={onDim} style={styles.sheet}>
      <StepHeading step={step} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {parts.map((part) => (
          <StepPart key={part.key} part={part} onChoose={onChoose} />
        ))}
      </ScrollView>
      <SheetEnd also={also} cancelKey={cancelKey} onCancel={onCancel} />
    </SheetFrame>
  );
});

/**
 * The over-end sheet, which no key opened (spec §4.4; the Batch 4 review's C1, I3 and M1, the controller's rulings): it
 * stands while an over is due with no bowler. Its dim takes no tap, since the dim covers the board, the top bar and the
 * keys, and a touch meant for any of them must not take the over's last ball back. Its way back is Undo (the kit's
 * word: the action takes back this phone's last tap, which may not be a ball), when this phone has one. Players and More
 * are on it, because an over's end is where a scorer declares, stops for rain, closes for time or retires a batter, and
 * "Nobody can bowl this over" would otherwise leave nothing to press; More only when the engine takes something now.
 */
export const CricketStandingSheet = memo(function CricketStandingSheet({
  step,
  undo,
  more,
  onChoose,
  onUndo,
  onPlayers,
  onMore,
}: {
  readonly step: CricketStep;
  readonly undo: boolean;
  readonly more: boolean;
  readonly onChoose: (id: string) => void;
  readonly onUndo: () => void;
  readonly onPlayers: () => void;
  readonly onMore: () => void;
}) {
  const also = useMemo(() => standingButtons(more, onPlayers, onMore), [more, onPlayers, onMore]);
  return (
    <CricketStepSheet
      step={step}
      onChoose={onChoose}
      onDim={null}
      onCancel={undo ? onUndo : null}
      cancelKey="scoring.pad.undo"
      also={also}
    />
  );
});

function standingButtons(
  more: boolean,
  onPlayers: () => void,
  onMore: () => void,
): readonly SheetButton[] {
  const players: SheetButton = { label: 'scoring.cricket.players.title', onPress: onPlayers };
  return more ? [players, { label: 'scoring.cricket.key.more', onPress: onMore }] : [players];
}

/** The step's title, and the line under it when it has one. */
function StepHeading({ step }: { readonly step: CricketStep }) {
  const words = usePadText();
  return (
    <>
      <Text variant="title" accessibilityRole="header">
        {words(step.title)}
      </Text>
      {step.body === null ? null : <Text variant="body">{words(step.body)}</Text>}
    </>
  );
}

/** Under the choices: the sheet's other buttons in a row, then its way back. */
function SheetEnd({
  also,
  cancelKey,
  onCancel,
}: {
  readonly also: readonly SheetButton[];
  readonly cancelKey: MessageKey;
  readonly onCancel: (() => void) | null;
}) {
  const { t } = useT();
  return (
    <>
      <AlsoRow buttons={also} />
      {onCancel === null ? null : <GhostButton label={t(cancelKey)} onPress={onCancel} />}
    </>
  );
}

/** The other buttons side by side, each an equal share of the row. */
function AlsoRow({ buttons }: { readonly buttons: readonly SheetButton[] }) {
  const { t } = useT();
  if (buttons.length === 0) return null;
  return (
    <View style={styles.also}>
      {buttons.map((one) => (
        <View key={one.label} style={styles.alsoCell}>
          <GhostButton label={t(one.label)} onPress={one.onPress} />
        </View>
      ))}
    </View>
  );
}

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
  also: { flexDirection: 'row', gap: space.sm },
  alsoCell: { flex: 1, minWidth: 0 },
  group: { gap: space.xs },
  groupName: { color: colour.ink2 },
  keys: { flexDirection: 'row', gap: space.sm },
  key: { flex: 1, minWidth: 0, alignItems: 'center', paddingHorizontal: 0 },
});

const KEY = sheetRowStyles([sheetRow.row, styles.key]);
