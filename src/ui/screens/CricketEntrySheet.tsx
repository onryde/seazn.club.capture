import { memo, useCallback, useState } from 'react';
import { KeyboardAvoidingView, Pressable, View } from 'react-native';
import type { CricketEntryField, CricketEntryStep } from '@/domain/scoring/cricketEntry';
import { useT } from '@/hooks/useLanguage';
import { usePadText } from '@/hooks/usePadText';
import { Button } from '@/ui/components/Button';
import { GhostButton } from '@/ui/components/GhostButton';
import { padSheet } from '@/ui/components/padSheet';
import { PointsField } from '@/ui/components/ScoreEntrySheet';
import { Text } from '@/ui/components/Text';

/** Three digits: `parseWholeNumber`'s most, which the domain reads the fields with. */
const DIGITS = 3;

/**
 * The numbers More asks typed (S2-4 spec §4.8; plan Task 15): a revision's overs and target, a rain break's overs lost.
 * Each field is the kit's whole-number field (`PointsField`), starting from the domain's value; a field may be left empty.
 * Record is greyed while the fields make no event the engine takes (`accepts`, the domain's `entryTap`); Cancel, the dim
 * and Back close it with nothing recorded. In a KeyboardAvoidingView as the kit's score sheet, for the number pad:
 * whether the fields clear the keyboard on a phone is a device check.
 */
export const CricketEntrySheet = memo(function CricketEntrySheet({
  step,
  accepts,
  onRecord,
  onCancel,
}: {
  readonly step: CricketEntryStep;
  readonly accepts: (values: readonly string[]) => boolean;
  readonly onRecord: (values: readonly string[]) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useT();
  const words = usePadText();
  const [values, setValues] = useState(() => step.fields.map((field) => field.initial));
  const change = useCallback(
    (index: number, text: string) =>
      setValues((now) => now.map((value, at) => (at === index ? text : value))),
    [],
  );
  const record = useCallback(() => onRecord(values), [onRecord, values]);
  return (
    <KeyboardAvoidingView behavior="padding" style={padSheet.overlay}>
      <Pressable aria-hidden onPress={onCancel} style={padSheet.dim} />
      <View testID="entry-sheet" accessibilityViewIsModal aria-modal style={padSheet.sheet}>
        <Text variant="title" accessibilityRole="header">
          {words(step.title)}
        </Text>
        {step.fields.map((field, index) => (
          <EntryField
            key={field.id}
            field={field}
            index={index}
            value={values[index] ?? ''}
            onChange={change}
          />
        ))}
        <Button
          label={t('scoring.cricket.entry.record')}
          onPress={record}
          disabled={!accepts(values)}
        />
        <GhostButton label={t('scoring.sheet.cancel')} onPress={onCancel} />
      </View>
    </KeyboardAvoidingView>
  );
});

const EntryField = memo(function EntryField({
  field,
  index,
  value,
  onChange,
}: {
  readonly field: CricketEntryField;
  readonly index: number;
  readonly value: string;
  readonly onChange: (index: number, text: string) => void;
}) {
  const words = usePadText();
  const change = useCallback((text: string) => onChange(index, text), [onChange, index]);
  return <PointsField label={words(field.label)} value={value} digits={DIGITS} onChange={change} />;
});
