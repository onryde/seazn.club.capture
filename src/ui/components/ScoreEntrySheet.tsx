import { memo, useCallback, useState } from 'react';
import { KeyboardAvoidingView, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { parseWholeNumber } from '@/domain/scoring/wholeNumber';
import { Button } from '@/ui/components/Button';
import { GhostButton } from '@/ui/components/GhostButton';
import { padSheet } from '@/ui/components/padSheet';
import { Text } from '@/ui/components/Text';
import { colour, layout, radius, space } from '@/ui/theme/tokens';
import { typeScale } from '@/ui/theme/type';

type ScoreEntrySheetProps = {
  readonly title: string;
  /** Each field's name, top side first: "Points — A. Sharma". */
  readonly labels: readonly [string, string];
  /** The points now, top side first: the fields start there. */
  readonly initial: readonly [number, number];
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  /** The two fields as typed. Confirm is enabled only while both read as whole numbers; the pad judges the rest. */
  readonly onSave: (first: string, second: string) => void;
  readonly onCancel: () => void;
};

/**
 * Two whole-number fields, one per side, over the pad. A field that does not read as a whole number (empty, a sign, a
 * decimal) keeps Confirm disabled; whether the numbers are a score a game can have is the pad's to say. Cancel, the dim
 * and Back (the caller's) close it with nothing changed. A plain View, as every pad sheet (`padSheet.ts`), in a
 * KeyboardAvoidingView: the number pad comes up over the bottom of the screen, and on an edge-to-edge Android window
 * nothing resizes for it, so the sheet is padded up by the keyboard's height (RN 0.86.3's `KeyboardAvoidingView`,
 * `keyboardDidShow` on Android). Whether the fields clear the keyboard on a phone is a device check.
 */
export const ScoreEntrySheet = memo(function ScoreEntrySheet({
  title,
  labels,
  initial,
  confirmLabel,
  cancelLabel,
  onSave,
  onCancel,
}: ScoreEntrySheetProps) {
  const [first, setFirst] = useState(() => String(initial[0]));
  const [second, setSecond] = useState(() => String(initial[1]));
  const save = useCallback(() => onSave(first, second), [onSave, first, second]);
  const readable = parseWholeNumber(first) !== null && parseWholeNumber(second) !== null;
  return (
    <KeyboardAvoidingView testID="score-sheet-frame" behavior="padding" style={padSheet.overlay}>
      <Pressable aria-hidden onPress={onCancel} style={padSheet.dim} />
      <View testID="score-sheet" accessibilityViewIsModal aria-modal style={padSheet.sheet}>
        <Text variant="title">{title}</Text>
        <PointsField label={labels[0]} value={first} onChange={setFirst} />
        <PointsField label={labels[1]} value={second} onChange={setSecond} />
        <Button label={confirmLabel} onPress={save} disabled={!readable} />
        <GhostButton label={cancelLabel} onPress={onCancel} />
      </View>
    </KeyboardAvoidingView>
  );
});

const PointsField = memo(function PointsField({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
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
        maxLength={3}
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
