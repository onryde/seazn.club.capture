import { memo, useCallback, useState } from 'react';
import { KeyboardAvoidingView, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { parseWholeNumber } from '@/domain/scoring/wholeNumber';
import { Button } from '@/ui/components/Button';
import { GhostButton } from '@/ui/components/GhostButton';
import { padSheet } from '@/ui/components/padSheet';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

/** The most a field holds when the sport names no bound: what three digits can say. */
const OPEN_BOUND = 999;

type ScoreEntrySheetProps = {
  readonly title: string;
  /** Each field's name, top side first: "Points — A. Sharma". */
  readonly labels: readonly [string, string];
  /** The points now, top side first: the fields start there. */
  readonly initial: readonly [number, number];
  /**
   * The most either field may hold (table tennis gives its engine's bound for the match's rules). Confirm is disabled
   * while a field is over it, and a field takes no more digits than it has. Unset, the sheet's own limit (three digits).
   */
  readonly bound?: number;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  /** The two fields as typed. Confirm is enabled only while both read as whole numbers; the pad judges the rest. */
  readonly onSave: (first: string, second: string) => void;
  readonly onCancel: () => void;
};

/**
 * Two whole-number fields, one per side, over the pad. A field that does not read as a whole number (empty, a sign, a
 * decimal), or reads above the sport's bound, keeps Confirm disabled; whether the numbers are a score a game can have is
 * the pad's to say. Cancel, the dim
 * and Back (the caller's) close it with nothing changed. A plain View, as every pad sheet (`padSheet.ts`), in a
 * KeyboardAvoidingView: the number pad comes up over the bottom of the screen, and on an edge-to-edge Android window
 * nothing resizes for it, so the sheet is padded up by the keyboard's height (RN 0.86.3's `KeyboardAvoidingView`,
 * `keyboardDidShow` on Android). Whether the fields clear the keyboard on a phone is a device check.
 */
export const ScoreEntrySheet = memo(function ScoreEntrySheet({
  title,
  labels,
  initial,
  bound = OPEN_BOUND,
  confirmLabel,
  cancelLabel,
  onSave,
  onCancel,
}: ScoreEntrySheetProps) {
  const [first, setFirst] = useState(() => String(initial[0]));
  const [second, setSecond] = useState(() => String(initial[1]));
  const digits = String(bound).length;
  const save = useCallback(() => onSave(first, second), [onSave, first, second]);
  const readable = within(first, bound) && within(second, bound);
  return (
    <KeyboardAvoidingView testID="score-sheet-frame" behavior="padding" style={padSheet.overlay}>
      <Pressable aria-hidden onPress={onCancel} style={padSheet.dim} />
      <View testID="score-sheet" accessibilityViewIsModal aria-modal style={padSheet.sheet}>
        <Text variant="title">{title}</Text>
        <PointsField label={labels[0]} value={first} digits={digits} onChange={setFirst} />
        <PointsField label={labels[1]} value={second} digits={digits} onChange={setSecond} />
        <Button label={confirmLabel} onPress={save} disabled={!readable} />
        <GhostButton label={cancelLabel} onPress={onCancel} />
      </View>
    </KeyboardAvoidingView>
  );
});

/** Whether a field reads as a whole number no greater than the bound. */
function within(text: string, bound: number): boolean {
  const number = parseWholeNumber(text);
  return number !== null && number <= bound;
}

const PointsField = memo(function PointsField({
  label,
  value,
  digits,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly digits: number;
  readonly onChange: (text: string) => void;
}) {
  return (
    <View style={styles.field}>
      <Text variant="controlInk" style={styles.fieldLabel}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        keyboardType="number-pad"
        maxLength={digits}
        selectTextOnFocus
        style={styles.input}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  fieldLabel: { flex: 1 },
  /** The points in the display face at the panel title's size, with tabular figures, as every score on the pad. */
  input: {
    ...typeScale.panelTitle,
    fontVariant: ['tabular-nums'],
    width: 2 * layout.touch,
    minHeight: layout.touch,
    paddingHorizontal: space.sm,
    textAlign: 'right',
    borderWidth: layout.iconBorder,
    borderColor: colour.ink3,
    borderRadius: radius.card,
    backgroundColor: colour.ground,
  },
});
