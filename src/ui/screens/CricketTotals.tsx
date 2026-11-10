import { memo, useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import {
  stepOver,
  type CricketTotals,
  type CricketTotalsEntry,
  type TotalsField,
  type TotalsOver,
} from '@/domain/scoring/cricketTotals';
import { useT } from '@/hooks/useLanguage';
import { usePadText } from '@/hooks/usePadText';
import type { MessageKey } from '@/i18n/messages';
import { Button } from '@/ui/components/Button';
import { sheetRow, sheetRowLabel, sheetRowStyles } from '@/ui/components/sheetRow';
import { Text } from '@/ui/components/Text';
import { colour, layout, space } from '@/ui/theme/tokens';

/**
 * Over totals (S2-4 spec §4.10; plan Task 17), drawn in the keys' place while a side's players are not entered: the
 * note ("Players not entered — ask the organiser"), then the over to enter, three steppers (runs, wickets, legal balls)
 * that start at nothing scored and the rest of the over, and Record over. A tie nobody can bat a super over for is the
 * organiser's line and nothing to enter (ruling 74). The domain says what the engine takes (`totals.fits`): a stepper
 * greys at the figure it would refuse, and Record over while the figures make no over. The entry starts again whenever
 * it is a new one (keyed by `entryKey`: the innings and its legal balls, not the over number, which a part over and the
 * next innings' first over leave where it was), so a tap on Record never leaves the last over's figures under the
 * thumb.
 */
export const CricketTotalsPanel = memo(function CricketTotalsPanel({
  totals,
  onRecord,
}: {
  readonly totals: CricketTotals;
  readonly onRecord: (over: TotalsOver) => void;
}) {
  const words = usePadText();
  return (
    <View testID="cricket-totals" style={styles.panel}>
      <Text testID="totals-note" variant="body" style={styles.note}>
        {words(totals.note)}
      </Text>
      {totals.kind === 'entry' ? (
        <>
          <Heading over={totals.over} />
          <TotalsFields key={totals.entryKey} totals={totals} onRecord={onRecord} />
        </>
      ) : null}
    </View>
  );
});

/** "Over 3 totals". */
function Heading({ over }: { readonly over: number }) {
  const { t } = useT();
  return (
    <Text variant="panelTitle" accessibilityRole="header">
      {t('scoring.cricket.totals.title', { number: over })}
    </Text>
  );
}

const FIELDS: readonly { readonly field: TotalsField; readonly label: MessageKey }[] = [
  { field: 'runs', label: 'scoring.cricket.totals.runs' },
  { field: 'wickets', label: 'scoring.cricket.totals.wickets' },
  { field: 'balls', label: 'scoring.cricket.totals.balls' },
];

/** What each field's two steppers may do now: down above its floor, up where the engine takes the next figure. */
type Reach = { readonly down: boolean; readonly up: boolean };

function reachOf(over: TotalsOver, totals: CricketTotalsEntry): readonly Reach[] {
  return FIELDS.map(({ field }) => {
    const up = stepOver(over, field, 1, totals.ballsMax);
    const down = stepOver(over, field, -1, totals.ballsMax);
    return { down: down !== over, up: up !== over && totals.fits(up) };
  });
}

/** The over being keyed in: its figures, a step of one field, and what each stepper may do now. */
function useOverFigures(totals: CricketTotalsEntry) {
  const [over, setOver] = useState(totals.start);
  const { ballsMax } = totals;
  const step = useCallback(
    (field: TotalsField, by: 1 | -1) => setOver((now) => stepOver(now, field, by, ballsMax)),
    [ballsMax],
  );
  const reach = useMemo(() => reachOf(over, totals), [over, totals]);
  return { over, step, reach };
}

/** The three steppers and Record over, from the over the entry starts at; the figures are this component's own. */
const TotalsFields = memo(function TotalsFields({
  totals,
  onRecord,
}: {
  readonly totals: CricketTotalsEntry;
  readonly onRecord: (over: TotalsOver) => void;
}) {
  const { t } = useT();
  const { over, step, reach } = useOverFigures(totals);
  const record = useCallback(() => onRecord(over), [onRecord, over]);
  return (
    <View style={styles.fields}>
      {FIELDS.map(({ field, label }, index) => (
        <FieldRow
          key={field}
          field={field}
          label={label}
          value={over[field]}
          reach={reach[index] as Reach}
          onStep={step}
        />
      ))}
      <Button
        label={t('scoring.cricket.totals.record')}
        onPress={record}
        disabled={!totals.fits(over)}
      />
    </View>
  );
});

/** A field: its name, − and + either side of its figure. */
const FieldRow = memo(function FieldRow({
  field,
  label,
  value,
  reach,
  onStep,
}: {
  readonly field: TotalsField;
  readonly label: MessageKey;
  readonly value: number;
  readonly reach: Reach;
  readonly onStep: (field: TotalsField, by: 1 | -1) => void;
}) {
  const { t } = useT();
  const name = t(label);
  return (
    <View testID={`totals-${field}`} style={styles.row}>
      <Text variant="label" numberOfLines={1} style={styles.name}>
        {name}
      </Text>
      <Stepper field={field} by={-1} name={name} on={reach.down} onStep={onStep} />
      <Text variant="title" testID={`totals-${field}-value`} style={styles.value}>
        {String(value)}
      </Text>
      <Stepper field={field} by={1} name={name} on={reach.up} onStep={onStep} />
    </View>
  );
});

/** One step of a field; a screen reader hears "Runs: 1 more". Greyed where the figure cannot go. */
const Stepper = memo(function Stepper({
  field,
  by,
  name,
  on,
  onStep,
}: {
  readonly field: TotalsField;
  readonly by: 1 | -1;
  readonly name: string;
  readonly on: boolean;
  readonly onStep: (field: TotalsField, by: 1 | -1) => void;
}) {
  const { t } = useT();
  const press = useCallback(() => onStep(field, by), [onStep, field, by]);
  const tone = on ? 'standard' : 'off';
  const label = t(by === 1 ? 'scoring.cricket.totals.more' : 'scoring.cricket.totals.less', {
    field: name,
  });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={!on}
      onPress={press}
      style={STEP[tone]}
    >
      <Text variant="action" style={sheetRowLabel[tone]}>
        {by === 1 ? '+' : '−'}
      </Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  panel: { gap: space.sm },
  note: { color: colour.ink },
  fields: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  name: { flex: 1, minWidth: 0, color: colour.ink },
  value: { width: layout.touch, textAlign: 'center', color: colour.lime },
  step: { width: layout.touch, alignItems: 'center', paddingHorizontal: 0 },
});

const STEP = sheetRowStyles([sheetRow.row, styles.step]);
